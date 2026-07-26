import './env';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { sandbox } from './db/schema';
import { getFreestyle } from './freestyle';
import {
  DAEMON_SOURCE,
  DAEMON_VERSION,
  ENSURE_DAEMON_SCRIPT,
} from './daemon-source.gen';
import { EXTENSION_SKILL, SKILL_PATH } from './extension-skill';
import {
  BROWSER_CLI,
  BROWSER_CLI_PATH,
  BROWSER_SKILL_PATH,
  BROWSER_TOOL_SKILL,
} from './browser-tool';

/**
 * Worker-side management of the VM daemon: the long-lived process on each
 * user's Freestyle VM that owns agent processes and relays everything
 * through the database. The server's whole interface to it is:
 *
 *  - install: write config (server URL + token) and the daemon/supervisor
 *    scripts to the VM (first init, or when an old VM predates the daemon)
 *  - wake: exec the supervisor, which self-updates the daemon source when
 *    the version differs and makes sure exactly one daemon runs
 *
 * Everything else — turns, updates, actions, settles — flows through
 * /api/daemon/* routes, authenticated by the per-sandbox daemon token.
 */

const DIR = '/opt/webbutler';
export { DAEMON_VERSION, DAEMON_SOURCE };

/** Local end-to-end mode (scripts/e2e-probe.mjs): no Freestyle — the
    probe runs daemon.mjs itself on this machine, so install/wake no-op. */
const localVm = () => process.env.WB_LOCAL_VM === '1';

/** The files the daemon writes to its VM on boot (skills + browser CLI),
    versioned with the daemon so updates propagate on the next wake. */
export function daemonAssets(): {
  version: string;
  files: Array<{
    path: string;
    content: string;
    executable?: boolean;
    linkAs?: string;
  }>;
} {
  return {
    version: DAEMON_VERSION,
    files: [
      { path: SKILL_PATH, content: EXTENSION_SKILL },
      { path: BROWSER_SKILL_PATH, content: BROWSER_TOOL_SKILL },
      {
        path: BROWSER_CLI_PATH,
        content: BROWSER_CLI,
        executable: true,
        linkAs: '/usr/local/bin/browser',
      },
    ],
  };
}

/** The daemon token for a user's sandbox, minting one if the row predates
    daemon support. */
export async function ensureDaemonToken(userId: string): Promise<string> {
  const row = await db.query.sandbox.findFirst({
    where: eq(sandbox.userId, userId),
  });
  if (!row) throw new Error('no sandbox');
  if (row.daemonToken) return row.daemonToken;
  const token = crypto.randomUUID();
  await db
    .update(sandbox)
    .set({ daemonToken: token })
    .where(eq(sandbox.userId, userId));
  return token;
}

/** Full install: config, supervisor, daemon source, version stamp. */
export async function installDaemon(
  vmId: string,
  serverUrl: string,
  token: string,
): Promise<void> {
  if (localVm()) return;
  const vm = getFreestyle().vms.ref({ vmId });
  await vm.exec({ command: `mkdir -p ${DIR}`, timeoutMs: 120_000 });
  await Promise.all([
    vm.fs.writeTextFile(
      `${DIR}/daemon.json`,
      JSON.stringify({ serverUrl, token }),
    ),
    vm.fs.writeTextFile(`${DIR}/ensure-daemon.sh`, ENSURE_DAEMON_SCRIPT),
    vm.fs.writeTextFile(`${DIR}/daemon.mjs`, DAEMON_SOURCE),
    vm.fs.writeTextFile(`${DIR}/daemon.version`, DAEMON_VERSION),
  ]);
}

/**
 * Make sure the daemon is running on the VM (waking the VM as a side
 * effect — Freestyle VMs start on exec). Installs first when the VM has
 * never had the daemon. Returns quietly on success; throws on VM errors
 * so callers can heal a deleted VM.
 */
export async function wakeDaemon(
  userId: string,
  vmId: string,
  serverUrl: string,
): Promise<void> {
  if (localVm()) return;
  const vm = getFreestyle().vms.ref({ vmId });
  // Heal a stale callback URL. The config is written at INSTALL time, so a
  // sandbox first initialized against a dev server keeps calling
  // http://localhost:8787 forever — every job then stalls into "the
  // sandbox did not pick this task up". When the URL on file differs from
  // the one we'd hand out now, rewrite it and retire the running daemon
  // (it read the old config at boot); the supervisor below starts a fresh
  // one.
  try {
    const raw = await vm.fs.readTextFile(`${DIR}/daemon.json`);
    const config = JSON.parse(raw) as { serverUrl?: string; token?: string };
    if (config.serverUrl !== serverUrl) {
      await vm.fs.writeTextFile(
        `${DIR}/daemon.json`,
        JSON.stringify({ ...config, serverUrl }),
      );
      await vm.exec({
        command:
          `PID=$(cat ${DIR}/daemon.pid 2>/dev/null); ` +
          `[ -n "$PID" ] && kill "$PID" 2>/dev/null; ` +
          `rm -f ${DIR}/daemon.pid; true`,
        timeoutMs: 120_000,
      });
    }
  } catch {
    // No config on the VM yet — the MISSING path below installs fresh.
  }
  const ensure = () =>
    vm.exec({
      command: `sh ${DIR}/ensure-daemon.sh ${DAEMON_VERSION} 2>/dev/null || echo MISSING`,
      timeoutMs: 120_000,
    });
  let result = await ensure();
  if ((result.stdout ?? '').includes('MISSING')) {
    const token = await ensureDaemonToken(userId);
    await installDaemon(vmId, serverUrl, token);
    result = await ensure();
    if ((result.stdout ?? '').includes('MISSING')) {
      throw new Error('daemon install failed on the sandbox');
    }
  }
}
