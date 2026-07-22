import './env';
import type { CodexAuthStatus } from './codex-auth';
import { getFreestyle } from './freestyle';

/**
 * Grok device-code onboarding on the user's sandbox VM.
 *
 * Unlike codex there is no app-server to speak a protocol to — but
 * `grok login --device-auth` is built for headless environments and prints
 * the verification URL + one-time code to plain (non-TTY) stdout, then
 * blocks until the browser-side sign-in completes. So the helper here just
 * spawns the CLI, greps the code out of its output, and mirrors progress
 * into a JSON state file — same shape and lifecycle as the codex flow.
 */

const DIR = '/opt/webbutler';
const HELPER_PATH = `${DIR}/grok-device-login.mjs`;
const STATE_PATH = `${DIR}/grok-login.json`;
const LOG_PATH = `${DIR}/grok-login.log`;

/**
 * x.ai doesn't disclose the code's lifetime; 15 minutes is the standard
 * OAuth device-code window and doubles as our cleanup backstop. The CLI
 * exits on its own if the code expires server-side first.
 */
const CODE_TTL_MS = 15 * 60 * 1000;

/** What the helper writes to STATE_PATH as the flow progresses. */
type GrokLoginFileState = {
  status: 'starting' | 'pending' | 'complete' | 'failed' | 'expired';
  userCode?: string;
  verificationUrl?: string;
  error?: string;
  startedAt?: number;
  pendingAt?: number;
};

/** Same wire shape as the codex flow — the extension treats them alike. */
export type GrokAuthStatus = CodexAuthStatus;

/**
 * Runs on the VM (node 24, ESM). Spawns `grok login --device-auth`, watches
 * combined output for the accounts.x.ai verification URL (which carries the
 * user code), and maps the CLI's exit into complete/failed/expired.
 * All backslashes are doubled — this source is embedded in a template.
 */
const HELPER_SOURCE = `// Written by the Web Butler server — do not edit.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const STATE_PATH = '${STATE_PATH}';
const state = { status: 'starting', startedAt: Date.now() };
const save = () => {
  state.updatedAt = Date.now();
  writeFileSync(STATE_PATH, JSON.stringify(state));
};
save();

const child = spawn('grok', ['login', '--device-auth'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const finish = (patch) => {
  Object.assign(state, patch);
  save();
  try {
    child.kill();
  } catch {}
  process.exit(0);
};

// The CLI logs with ANSI color; strip before matching.
const clean = (text) => text.replace(/\\u001b\\[[0-9;]*[A-Za-z]/g, '');

let output = '';
const onChunk = (chunk) => {
  output += chunk.toString();
  if (state.status !== 'starting') return;
  // "To sign in, open this URL in your browser:
  //    https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX"
  const match = clean(output).match(
    /https:\\/\\/accounts\\.x\\.ai\\/\\S*user_code=([A-Za-z0-9-]+)/,
  );
  if (!match) return;
  Object.assign(state, {
    status: 'pending',
    verificationUrl: match[0],
    userCode: match[1],
    pendingAt: Date.now(),
  });
  save();
  // Cleanup backstop past the code's own lifetime.
  setTimeout(
    () => finish({ status: 'expired', error: 'device code expired' }),
    ${CODE_TTL_MS},
  );
};
child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

child.on('exit', (code) => {
  if (code === 0) {
    state.status = 'complete';
    save();
    process.exit(0);
  }
  // Failed — surface the CLI's own words, minus its tracing log lines.
  const lines = clean(output)
    .split('\\n')
    .map((line) => line.trim())
    .filter((line) => line && !/ (INFO|WARN|DEBUG) /.test(line));
  const reason =
    lines.reverse().find((line) => /error|fail|expir|denied/i.test(line)) ??
    'grok login exited with code ' + code;
  state.status = /expir/i.test(reason) ? 'expired' : 'failed';
  state.error = reason.slice(0, 300);
  save();
  process.exit(1);
});

// Backstop for a flow that never even reaches pending.
setTimeout(() => {
  if (state.status === 'starting') {
    finish({ status: 'failed', error: 'timed out waiting for a device code' });
  }
}, 2 * 60 * 1000);
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type VmRef = ReturnType<ReturnType<typeof getFreestyle>['vms']['ref']>;

async function readState(vm: VmRef): Promise<GrokLoginFileState | null> {
  try {
    return JSON.parse(await vm.fs.readTextFile(STATE_PATH));
  } catch {
    return null; // no flow started (or VM still waking) — both read as "none"
  }
}

/**
 * (Re)start the device-code flow on the user's VM and return the code the
 * user must enter. Restarting is always safe: any previous helper (and its
 * grok process) is killed first, so at most one login flow runs per VM.
 */
export async function startGrokDeviceLogin(
  vmId: string,
): Promise<GrokAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });

  await vm.exec(`mkdir -p ${DIR}`);
  await vm.fs.writeTextFile(HELPER_PATH, HELPER_SOURCE);
  await vm.exec(
    `pkill -f ${HELPER_PATH}; pkill -f 'grok login'; rm -f ${STATE_PATH}; true`,
  );
  await vm.exec(`nohup node ${HELPER_PATH} > ${LOG_PATH} 2>&1 & echo $!`);

  // Minting the code is one round-trip from the VM to x.ai.
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    const state = await readState(vm);
    if (!state || state.status === 'starting') continue;
    if (state.status === 'pending') {
      return {
        status: 'pending',
        userCode: state.userCode,
        verificationUrl: state.verificationUrl,
        expiresAt: (state.pendingAt ?? Date.now()) + CODE_TTL_MS,
      };
    }
    throw new Error(state.error ?? `login ${state.status}`);
  }
  throw new Error('timed out waiting for a device code');
}

/**
 * Where the VM's grok auth stands. `grok models` is the live probe — it
 * exits 0 either way, but prints "You are not authenticated." when signed
 * out. The state file only adds detail for in-flight and failed flows.
 */
export async function getGrokAuthStatus(
  vmId: string,
): Promise<GrokAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });
  const state = await readState(vm);

  if (state?.status === 'starting' || state?.status === 'pending') {
    return {
      status: 'pending',
      userCode: state.userCode,
      verificationUrl: state.verificationUrl,
      expiresAt:
        state.pendingAt != null ? state.pendingAt + CODE_TTL_MS : undefined,
    };
  }

  const check = await vm.exec({
    command: 'grok models 2>&1',
    timeoutMs: 30_000,
  });
  const out = `${check.stdout ?? ''}${check.stderr ?? ''}`;
  if (check.statusCode === 0 && !/not authenticated/i.test(out)) {
    return { status: 'connected' };
  }

  if (state?.status === 'failed' || state?.status === 'expired') {
    return { status: state.status, error: state.error };
  }
  return { status: 'disconnected' };
}
