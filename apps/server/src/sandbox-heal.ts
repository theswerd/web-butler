/**
 * Self-healing for deleted sandbox VMs.
 *
 * Freestyle VMs are ephemeral: an idle sandbox can be reaped upstream, after
 * which every exec against the stored vmId throws VM_DELETED forever. Without
 * recovery, that turns into a wall of 500s that the extension can only read
 * as "server unreachable". The fix is to treat VM_DELETED as "provision a
 * replacement and carry on": swap the user's sandbox row to a fresh VM and
 * retry the operation once against it.
 *
 * A replacement VM starts logged out of every provider, so after healing the
 * status endpoints truthfully report `disconnected` and the extension walks
 * the user through reauth — the same story as a first-time connect.
 */
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { sandbox } from './db/schema';
import { getFreestyle } from './freestyle';

/** Freestyle's "this VM is gone" — the only error that warrants healing. */
export function isVmDeleted(error: unknown): boolean {
  const body = (error as { body?: { code?: string } } | null)?.body;
  return body?.code === 'VM_DELETED' || String(error).includes('VM_DELETED');
}

/**
 * Coalesces concurrent replacements per user: the three provider status
 * calls fire together, and each would otherwise mint its own VM (the DB
 * guard would delete the losers, but that's needless churn).
 */
const replacing = new Map<string, Promise<string>>();

/**
 * Run `fn` against the user's sandbox VM, healing a deleted VM once: on
 * VM_DELETED, provision a replacement, point the sandbox row at it, and
 * retry `fn` with the new id. Any other error propagates untouched.
 */
export async function withSandboxVm<T>(
  userId: string,
  vmId: string,
  fn: (vmId: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(vmId);
  } catch (error) {
    if (!isVmDeleted(error)) throw error;
    const fresh = await replaceSandboxVm(userId, vmId);
    return await fn(fresh);
  }
}

async function replaceSandboxVm(
  userId: string,
  deadVmId: string,
): Promise<string> {
  const inFlight = replacing.get(userId);
  if (inFlight) return inFlight;

  const job = (async () => {
    // Another server instance (or an earlier request) may already have
    // healed this user — if the row moved on, use its VM.
    const row = await db.query.sandbox.findFirst({
      where: eq(sandbox.userId, userId),
    });
    if (row && row.vmId !== deadVmId) return row.vmId;

    console.warn(
      `[sandbox] VM ${deadVmId} was deleted upstream; provisioning a replacement for user ${userId}`,
    );
    const { vmId } = await getFreestyle().vms.create({
      snapshotId: process.env.FREESTYLE_SNAPSHOT_ID ?? null,
    });

    // Guarded swap: only move the row if it still points at the dead VM.
    // Losing the race means someone else's replacement won — delete ours
    // rather than leak it.
    const updated = await db
      .update(sandbox)
      .set({ vmId })
      .where(and(eq(sandbox.userId, userId), eq(sandbox.vmId, deadVmId)))
      .returning();
    if (updated.length === 0) {
      void getFreestyle()
        .vms.delete({ vmId })
        .catch(() => {});
      const winner = await db.query.sandbox.findFirst({
        where: eq(sandbox.userId, userId),
      });
      if (!winner) throw new Error('sandbox row disappeared during healing');
      return winner.vmId;
    }
    return vmId;
  })();

  replacing.set(userId, job);
  try {
    return await job;
  } finally {
    replacing.delete(userId);
  }
}
