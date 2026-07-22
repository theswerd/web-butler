import './env';
import { getFreestyle } from './freestyle';

/**
 * Codex device-code onboarding, passed through the user's sandbox VM.
 *
 * The CLI must end up authenticated *on the VM* (that's where agents run),
 * but the user is in their browser — so the flow is: spawn `codex
 * app-server` on the VM, ask it for a ChatGPT device code, hand the
 * code + verification URL to the extension, and let the app-server poll
 * OpenAI in the background until the user finishes signing in. A tiny
 * helper script owns the app-server process and mirrors progress into a
 * JSON state file that the endpoints below read.
 */

const DIR = '/opt/webbutler';
const HELPER_PATH = `${DIR}/codex-device-login.mjs`;
const STATE_PATH = `${DIR}/codex-login.json`;
const LOG_PATH = `${DIR}/codex-login.log`;

/**
 * How long a minted code stays usable. The device-auth response carries no
 * expiry field; this mirrors codex's own hardcoded poll deadline
 * (`max_wait = 15 * 60` in codex-rs/login/src/device_code_auth.rs), after
 * which the app-server reports the login as failed.
 */
const CODE_TTL_MS = 15 * 60 * 1000;

/** What the helper writes to STATE_PATH as the flow progresses. */
type CodexLoginFileState = {
  status: 'starting' | 'pending' | 'complete' | 'failed' | 'expired';
  userCode?: string;
  verificationUrl?: string;
  error?: string;
  startedAt?: number;
  /** When the code was minted — codex's 15-minute clock starts here. */
  pendingAt?: number;
};

/** What the API reports to the extension. */
export type CodexAuthStatus = {
  status: 'connected' | 'pending' | 'disconnected' | 'failed' | 'expired';
  userCode?: string;
  verificationUrl?: string;
  /** When the pending code stops working (ms epoch) — drives countdown UI. */
  expiresAt?: number;
  error?: string;
};

/**
 * Runs on the VM (node 24, ESM). Speaks JSON-RPC to `codex app-server`
 * over stdio: initialize → account/login/start (chatgptDeviceCode) →
 * wait for the account/login/completed notification. No template
 * literals inside — this source is itself embedded in one.
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

const child = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'ignore'],
});

const finish = (patch) => {
  Object.assign(state, patch);
  save();
  child.kill();
  process.exit(0);
};

const send = (message) => {
  child.stdin.write(JSON.stringify(message) + '\\n');
};

const handle = (message) => {
  if (message.id === 0) {
    // initialize acked — request the device code.
    send({ jsonrpc: '2.0', method: 'initialized' });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'account/login/start',
      params: { type: 'chatgptDeviceCode' },
    });
  } else if (message.id === 1) {
    if (message.error) {
      finish({
        status: 'failed',
        error: message.error.message || 'login start failed',
      });
    } else {
      Object.assign(state, {
        status: 'pending',
        userCode: message.result.userCode,
        verificationUrl: message.result.verificationUrl,
        // Anchors the expiry countdown: codex's own 15-minute poll deadline
        // starts when the code is minted, i.e. right about now.
        pendingAt: Date.now(),
      });
      save();
      // The code is now live — expire exactly when codex's poll gives up.
      setTimeout(
        () => finish({ status: 'expired', error: 'device code expired' }),
        ${CODE_TTL_MS},
      );
    }
  } else if (message.method === 'account/login/completed') {
    const params = message.params || {};
    finish(
      params.success
        ? { status: 'complete' }
        : { status: 'failed', error: params.error || 'login failed' },
    );
  }
};

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});

child.on('exit', () => {
  if (state.status === 'starting' || state.status === 'pending') {
    state.status = 'failed';
    state.error = 'codex app-server exited unexpectedly';
    save();
    process.exit(1);
  }
});

send({
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    clientInfo: { name: 'webbutler', title: 'Web Butler', version: '0.0.1' },
    capabilities: { experimentalApi: true },
  },
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

async function readState(vm: VmRef): Promise<CodexLoginFileState | null> {
  try {
    return JSON.parse(await vm.fs.readTextFile(STATE_PATH));
  } catch {
    return null; // no flow started (or VM still waking) — both read as "none"
  }
}

/**
 * (Re)start the device-code flow on the user's VM and return the code the
 * user must enter. Restarting is always safe: any previous helper (and its
 * app-server) is killed first, so at most one login flow runs per VM.
 */
export async function startCodexDeviceLogin(
  vmId: string,
): Promise<CodexAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });

  await vm.exec(`mkdir -p ${DIR}`);
  await vm.fs.writeTextFile(HELPER_PATH, HELPER_SOURCE);
  await vm.exec(
    `pkill -f ${HELPER_PATH}; pkill -f 'codex app-server'; rm -f ${STATE_PATH}; true`,
  );
  await vm.exec(`nohup node ${HELPER_PATH} > ${LOG_PATH} 2>&1 & echo $!`);

  // The device code needs one round-trip from the VM to OpenAI — usually
  // a second or two.
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
 * Where the VM's codex auth stands. `codex login status` (exit 0 when
 * authenticated) is the source of truth; the state file only adds detail
 * for in-flight and failed flows.
 */
export async function getCodexAuthStatus(
  vmId: string,
): Promise<CodexAuthStatus> {
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
    command: 'codex login status',
    timeoutMs: 30_000,
  });
  if (check.statusCode === 0) return { status: 'connected' };

  if (state?.status === 'failed' || state?.status === 'expired') {
    return { status: state.status, error: state.error };
  }
  return { status: 'disconnected' };
}
