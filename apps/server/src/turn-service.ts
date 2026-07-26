import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { browserAction, extension, task, turn, turnUpdate } from './db/schema';
import {
  extensionClaimRetryMessage,
  extensionProblem,
  newOutcomePath,
  outcomeRetryMessage,
  parseOutcomesRaw,
  type Outcome,
  type OutcomeRead,
} from './butler';

/**
 * The turn engine's server half. Turns live entirely in Postgres (see the
 * `turn` table): the extension enqueues them, the VM daemon executes them
 * and negotiates settlement here, and the extension polls the row until it
 * settles. This module holds the settle-side policy — outcome validation,
 * the one corrective retry, claim-vs-outcome consistency, extension
 * persistence — so the daemon stays a dumb relay.
 */

export type TurnRow = typeof turn.$inferSelect;

// ---------------------------------------------------------------------------
// Claim-vs-outcome consistency. An agent that SAYS "I installed an
// extension" without declaring one in its outcome file leaves the user
// with a confident claim and nothing behind it. The detector is a
// heuristic on purpose: a false positive costs one corrective turn or a
// visible warning, a false negative costs the user an extension that
// silently never existed.
// ---------------------------------------------------------------------------

/** A completed-sounding verb near "extension", either order, within one
    sentence. Past-tense forms only, so instructions like "you can create
    an extension by..." don't read as claims. */
const EXTENSION_CLAIM =
  /\b(?:installed|created|updated|added|saved|registered|set\s+up)\b[^.!?\n]{0,60}\bextensions?\b|\bextensions?\b[^.!?\n]{0,60}\b(?:installed|created|updated|added|saved|registered|set\s+up)\b/gi;

/** Words that turn a matched mention into an honest admission ("I could
    not install the extension"). Pushing back on those would punish the
    agent for telling the truth. */
const CLAIM_NEGATION =
  /\b(?:not|no|never|none|unable|cannot|can't|couldn't|didn't|wasn't|hasn't|haven't|won't|fail\w*|instead|without)\b/i;

/**
 * True when the turn produced no extension outcome but its text still
 * asserts one was installed, created, or updated. `reply` carries the
 * streamed assistant text for the first pass; the post-retry pass omits
 * it, because a retry can rewrite the outcome but never the stream.
 */
function claimsExtensionWithoutOutcome(
  outcomes: Outcome[],
  reply = '',
): boolean {
  if (outcomes.some((outcome) => outcome.type === 'extension')) return false;
  const texts = [
    reply,
    ...outcomes.flatMap((outcome) =>
      outcome.type === 'response' || outcome.type === 'artifact'
        ? [outcome.markdown]
        : [],
    ),
  ];
  return texts.some((text) =>
    [...text.matchAll(EXTENSION_CLAIM)].some((match) => {
      // The negation often sits just before the matched window ("No
      // extension was installed"), so scan a short same-sentence
      // look-behind together with the match itself.
      const lead =
        text
          .slice(Math.max(0, match.index - 40), match.index)
          .split(/[.!?\n]/)
          .pop() ?? '';
      return !CLAIM_NEGATION.test(lead + match[0]);
    }),
  );
}

const EXTENSION_CLAIM_WARNING =
  '**Warning:** this reply mentions an installed extension, but no ' +
  'extension was actually saved. Nothing persistent was created. Try ' +
  'asking again.';

/** Pin the warning onto the response outcome (or add one) so the unbacked
    claim never reaches the user looking like a success. */
function withExtensionClaimWarning(outcomes: Outcome[]): Outcome[] {
  let appended = false;
  const flagged = outcomes.map((outcome): Outcome => {
    if (outcome.type !== 'response' || appended) return outcome;
    appended = true;
    return {
      ...outcome,
      markdown: `${outcome.markdown}\n\n${EXTENSION_CLAIM_WARNING}`,
    };
  });
  if (!appended) {
    flagged.push({ type: 'response', markdown: EXTENSION_CLAIM_WARNING });
  }
  return flagged;
}

/**
 * Apply the agent's extension outcomes to the DB. Each outcome is either
 * enriched with the stored row's identity (so the client can upsert its
 * cache and register the user script without refetching) or replaced by a
 * response outcome explaining why it was rejected — the turn still lands.
 */
async function storeExtensionOutcomes(
  userId: string,
  taskId: string | undefined,
  outcomes: Outcome[],
): Promise<Outcome[]> {
  const processed: Outcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.type !== 'extension') {
      processed.push(outcome);
      continue;
    }
    const problem = extensionProblem(outcome);
    if (problem) {
      console.warn(`[butler] extension outcome rejected: ${problem}`);
      processed.push({
        type: 'response',
        markdown: `I tried to ${outcome.action} a page extension ("${outcome.name}") but it was rejected: ${problem}.`,
      });
      continue;
    }
    const now = Date.now();
    if (outcome.action === 'create') {
      const id = crypto.randomUUID();
      await db.insert(extension).values({
        id,
        userId,
        name: outcome.name,
        description: outcome.description,
        urlPatterns: outcome.urlPatterns,
        script: outcome.script,
        stage: outcome.stage,
        taskId,
        createdAt: now,
        updatedAt: now,
      });
      processed.push({ ...outcome, id });
    } else if (outcome.action === 'update') {
      const [row] = await db
        .update(extension)
        .set({
          name: outcome.name,
          description: outcome.description,
          urlPatterns: outcome.urlPatterns,
          script: outcome.script,
          stage: outcome.stage,
          taskId,
          updatedAt: now,
          version: sql`${extension.version} + 1`,
        })
        .where(
          and(eq(extension.id, outcome.id!), eq(extension.userId, userId)),
        )
        .returning();
      if (!row) {
        processed.push({
          type: 'response',
          markdown: `I tried to update a page extension but its id ("${outcome.id}") doesn't exist anymore.`,
        });
        continue;
      }
      processed.push(outcome);
    } else {
      await db
        .delete(extension)
        .where(
          and(eq(extension.id, outcome.id!), eq(extension.userId, userId)),
        );
      processed.push(outcome);
    }
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Starters parsing (turns with kind 'starters' settle from the reply text
// alone — no outcome file, no claim checks).
// ---------------------------------------------------------------------------

/** The model was told "JSON array only", but models decorate — take the
    outermost bracketed slice and validate the shape strictly. */
export function parseStarters(reply: string): string[] {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= 90)
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Settlement.
// ---------------------------------------------------------------------------

export type SettlePayload = {
  turnId: string;
  reply?: string;
  stopReason?: string;
  /** The outcome file's raw content, read locally by the daemon. */
  outcomeRaw?: string | null;
  /** True when this settle follows a corrective retry we asked for. */
  retried?: boolean;
  /** Set when the turn (or its retry) threw instead of finishing. */
  error?: string;
};

export type SettleVerdict =
  | { turnId: string; ok: true }
  | { turnId: string; retry: { message: string; outcomePath: string } };

/** Fallback settle of the task row at a turn's terminal: if the extension
    never comes back for the result (browser closed for good), the row
    must not claim "running" forever. The extension's own settle re-syncs
    richer fields over this when it does return. */
async function settleTaskRow(
  turnRow: TurnRow,
  status: 'done' | 'failed' | 'stopped',
  summary: string,
): Promise<void> {
  if (!turnRow.taskId) return;
  try {
    await db
      .update(task)
      .set({ status, outcome: summary.slice(0, 200), finishedAt: Date.now() })
      .where(
        and(
          eq(task.id, turnRow.taskId),
          eq(task.userId, turnRow.userId),
          eq(task.status, 'running'),
        ),
      );
  } catch (error) {
    console.warn('[butler] terminal task settle failed:', error);
  }
}

async function finalizeTurn(
  turnRow: TurnRow,
  fields: Partial<typeof turn.$inferInsert>,
): Promise<void> {
  await db
    .update(turn)
    .set({
      finishedAt: Date.now(),
      retryKind: null,
      pendingOutcomes: null,
      ...fields,
    })
    .where(eq(turn.id, turnRow.id));
}

/**
 * Process one settle from the daemon. Returns either {ok} — the turn is
 * finished and its terminal payload stored — or a corrective-retry
 * directive the daemon runs on the same agent session before settling
 * again. Mirrors the retry policy the in-process server used: at most ONE
 * corrective turn total, shared between the two failure modes (rejected
 * outcome file, unbacked extension claim).
 */
export async function processSettle(
  userId: string,
  settle: SettlePayload,
): Promise<SettleVerdict> {
  const turnRow = await db.query.turn.findFirst({
    where: and(eq(turn.id, settle.turnId), eq(turn.userId, userId)),
  });
  // Unknown or already-settled turn: nothing to negotiate.
  if (!turnRow || (turnRow.status !== 'running' && turnRow.status !== 'queued')) {
    return { turnId: settle.turnId, ok: true };
  }

  const cancelled = turnRow.cancelRequested;

  // Starters settle from the reply alone.
  if (turnRow.kind === 'starters') {
    await finalizeTurn(turnRow, {
      status: settle.error && !cancelled ? 'failed' : 'done',
      reply: settle.reply ?? '',
      error: settle.error ?? null,
      suggestions: settle.error ? [] : parseStarters(settle.reply ?? ''),
    });
    return { turnId: settle.turnId, ok: true };
  }

  // A turn that crashed outright (agent error, provider not signed in).
  if (settle.error !== undefined && settle.outcomeRaw == null && !settle.reply) {
    await finalizeTurn(turnRow, {
      status: cancelled ? 'cancelled' : 'failed',
      error: settle.error,
    });
    await settleTaskRow(turnRow, cancelled ? 'stopped' : 'failed', settle.error);
    return { turnId: settle.turnId, ok: true };
  }

  const reply = settle.reply ?? '';
  let read: OutcomeRead = parseOutcomesRaw(settle.outcomeRaw, reply);

  // First pass: one corrective retry when the file was rejected or the
  // reply claims an extension the file never declared. Not for cancelled
  // turns — the user already moved on.
  if (!settle.retried && turnRow.retries < 1 && !cancelled) {
    const retryPath = newOutcomePath();
    let retryMessage: string | null = null;
    let retryKind: 'invalid' | 'claim' | null = null;
    if (read.invalid) {
      retryMessage = outcomeRetryMessage(read.invalid, retryPath);
      retryKind = 'invalid';
    } else if (claimsExtensionWithoutOutcome(read.outcomes, reply)) {
      retryMessage = extensionClaimRetryMessage(
        retryPath,
        read.fileMissing === true,
      );
      retryKind = 'claim';
    }
    if (retryMessage && retryKind) {
      await db
        .update(turn)
        .set({
          retries: turnRow.retries + 1,
          retryKind,
          pendingOutcomes: read as unknown as Record<string, unknown>,
        })
        .where(eq(turn.id, turnRow.id));
      return {
        turnId: settle.turnId,
        retry: { message: retryMessage, outcomePath: retryPath },
      };
    }
  }

  // Second pass (or first pass that needed no correction): a failed or
  // fruitless retry falls back to the stashed first-round outcomes so the
  // turn still lands with an honest warning.
  if (settle.retried && turnRow.retryKind) {
    const stashed = turnRow.pendingOutcomes as OutcomeRead | null;
    const retryFailed =
      settle.error !== undefined || read.invalid || read.fileMissing;
    if (retryFailed && stashed) read = stashed;

    if (turnRow.retryKind === 'invalid' && read.invalid) {
      read = {
        ...read,
        outcomes: [
          {
            type: 'response',
            markdown:
              `${reply.trim() || 'Done.'}\n\n` +
              `**Warning:** the structured result for this turn was malformed (${read.invalid}), ` +
              'so anything it claims to have installed or produced was NOT saved. Try asking again.',
          },
        ],
      };
    } else if (
      turnRow.retryKind === 'claim' &&
      claimsExtensionWithoutOutcome(read.outcomes)
    ) {
      read = { ...read, outcomes: withExtensionClaimWarning(read.outcomes) };
    }
  } else if (read.invalid) {
    // No retry was possible (cancelled, or retries exhausted) but the file
    // was still bad — the warning must reach the user regardless.
    read = {
      ...read,
      outcomes: [
        {
          type: 'response',
          markdown:
            `${reply.trim() || 'Done.'}\n\n` +
            `**Warning:** the structured result for this turn was malformed (${read.invalid}), ` +
            'so anything it claims to have installed or produced was NOT saved. Try asking again.',
        },
      ],
    };
  }

  const outcomes = await storeExtensionOutcomes(
    userId,
    turnRow.taskId ?? undefined,
    read.outcomes,
  );

  await finalizeTurn(turnRow, {
    status: cancelled ? 'cancelled' : 'done',
    reply,
    stopReason: settle.stopReason ?? 'end_turn',
    outcomes: outcomes as unknown as Record<string, unknown>[],
    suggestions: read.suggestions ?? null,
    highlights: (read.highlights ?? null) as unknown as Record<
      string,
      unknown
    >[],
  });
  const summary = reply.trim() ? reply.trim() : 'Finished';
  await settleTaskRow(turnRow, cancelled ? 'stopped' : 'done', summary);
  return { turnId: settle.turnId, ok: true };
}

// ---------------------------------------------------------------------------
// Lazy sweeps: with no long-lived process anywhere, staleness is detected
// on read. Called from the extension's turn poll.
// ---------------------------------------------------------------------------

/** A running turn whose daemon hasn't synced in this long is dead. */
export const TURN_HEARTBEAT_STALE_MS = 120_000;
/** A queued turn nobody picked up in this long failed to wake anything. */
export const TURN_QUEUE_STALE_MS = 180_000;

/**
 * Fail a turn the daemon abandoned (VM died, daemon crashed) or that no
 * daemon ever picked up. Returns the refreshed row when it swept.
 */
export async function sweepStaleTurn(turnRow: TurnRow): Promise<TurnRow> {
  const now = Date.now();
  const stale =
    (turnRow.status === 'running' &&
      now - (turnRow.heartbeatAt ?? turnRow.startedAt ?? turnRow.createdAt) >
        TURN_HEARTBEAT_STALE_MS) ||
    (turnRow.status === 'queued' &&
      now - turnRow.createdAt > TURN_QUEUE_STALE_MS);
  if (!stale) return turnRow;
  const error =
    turnRow.status === 'queued'
      ? 'The sandbox did not pick this task up. It may still be waking; try again.'
      : 'The sandbox went quiet mid-task. Try again.';
  const [updated] = await db
    .update(turn)
    .set({ status: 'failed', error, finishedAt: now })
    .where(and(eq(turn.id, turnRow.id), eq(turn.status, turnRow.status)))
    .returning();
  if (updated) {
    await settleTaskRow(updated, 'failed', error);
    return updated;
  }
  return turnRow;
}

/**
 * Opportunistic garbage collection, run when a new turn is created: old
 * settled turns (and their update batches / leftover actions) have served
 * their purpose once the extension collected the terminal payload.
 */
export async function cleanupOldTurns(userId: string): Promise<void> {
  const cutoff = Date.now() - 60 * 60_000;
  const old = await db
    .delete(turn)
    .where(
      and(
        eq(turn.userId, userId),
        ne(turn.status, 'running'),
        ne(turn.status, 'queued'),
        lt(turn.finishedAt, cutoff),
      ),
    )
    .returning({ id: turn.id });
  if (old.length > 0) {
    const ids = old.map((row) => row.id);
    await db.delete(turnUpdate).where(inArray(turnUpdate.turnId, ids));
    await db.delete(browserAction).where(inArray(browserAction.turnId, ids));
  }
}
