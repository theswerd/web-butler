import './env';
import type { CodexAuthStatus } from './codex-auth';
import { getFreestyle } from './freestyle';

/**
 * Claude Code onboarding on the user's sandbox VM.
 *
 * Claude's login is a *reverse* device flow: `claude auth login` prints an
 * OAuth URL and then blocks on stdin with "Paste code here if prompted >".
 * The user signs in at that URL, Anthropic shows them an authorization
 * code, and they paste it back into the extension — which we forward to
 * the CLI's stdin through a drop file on the VM. The helper mirrors
 * progress into the same JSON state-file shape as the codex/grok flows;
 * the only difference is `pending` has no userCode to display and instead
 * *accepts* a code via submitClaudeLoginCode().
 */

const DIR = '/opt/webbutler';
const HELPER_PATH = `${DIR}/claude-device-login.mjs`;
const STATE_PATH = `${DIR}/claude-login.json`;
const LOG_PATH = `${DIR}/claude-login.log`;
/** Where the server drops the pasted code for the helper to pick up. */
const CODE_DROP_PATH = `${DIR}/claude-login-code`;

/** The OAuth state won't live forever; clean up abandoned flows. */
const FLOW_TTL_MS = 15 * 60 * 1000;

type ClaudeLoginFileState = {
  status: 'starting' | 'pending' | 'complete' | 'failed' | 'expired';
  verificationUrl?: string;
  error?: string;
  startedAt?: number;
  pendingAt?: number;
};

/** Same wire shape as the other providers — the extension treats them alike. */
export type ClaudeAuthStatus = CodexAuthStatus;

/**
 * Runs on the VM (node 24, ESM). Spawns `claude auth login`, greps the
 * OAuth URL out of stdout, then waits for the pasted code to appear in the
 * drop file and feeds it to the CLI's stdin. All backslashes are doubled —
 * this source is embedded in a template.
 */
const HELPER_SOURCE = `// Written by the Web Butler server — do not edit.
import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const STATE_PATH = '${STATE_PATH}';
const CODE_DROP_PATH = '${CODE_DROP_PATH}';
const state = { status: 'starting', startedAt: Date.now() };
const save = () => {
  state.updatedAt = Date.now();
  writeFileSync(STATE_PATH, JSON.stringify(state));
};
save();

const child = spawn('claude', ['auth', 'login'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

const finish = (patch) => {
  Object.assign(state, patch);
  save();
  try {
    child.kill();
  } catch {}
  process.exit(0);
};

const clean = (text) => text.replace(/\\u001b\\][^\\u0007]*\\u0007|\\u001b\\[[0-9;]*[A-Za-z]/g, '');

let output = '';
// Marks where to start scanning for a verdict on the last submitted code.
let submittedAt = -1;
const onChunk = (chunk) => {
  output += chunk.toString();
  const text = clean(output);
  // "If the browser didn't open, visit: https://claude.com/cai/oauth/..."
  // A rejected code makes the CLI re-prompt with a FRESH URL (new PKCE
  // challenge), so always track the last one printed.
  const urls = text.match(/https:\\/\\/claude\\.com\\/\\S+/g);
  if (!urls) return;
  const latest = urls[urls.length - 1];
  if (state.status === 'starting') {
    Object.assign(state, {
      status: 'pending',
      verificationUrl: latest,
      pendingAt: Date.now(),
    });
    save();
    return;
  }
  if (state.verificationUrl !== latest) {
    state.verificationUrl = latest;
    save();
  }
  // Verdict on the last pasted code: the CLI says so and re-prompts.
  if (submittedAt >= 0 && text.slice(submittedAt).includes('Invalid code')) {
    submittedAt = -1;
    state.error = 'That code didn’t work. Copy the full code and try again.';
    save();
  }
};
child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

// The pasted code arrives via the drop file — feed it to the CLI.
const poll = setInterval(() => {
  let code;
  try {
    code = readFileSync(CODE_DROP_PATH, 'utf8').trim();
    unlinkSync(CODE_DROP_PATH);
  } catch {
    return;
  }
  if (!code) return;
  delete state.error;
  save();
  submittedAt = clean(output).length;
  child.stdin.write(code + '\\n');
}, 500);

child.on('exit', (code) => {
  clearInterval(poll);
  if (code === 0) {
    state.status = 'complete';
    save();
    process.exit(0);
  }
  const lines = clean(output)
    .split('\\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const reason =
    lines.reverse().find((line) => /error|fail|invalid|expir|denied/i.test(line)) ??
    'claude auth login exited with code ' + code;
  state.status = /expir/i.test(reason) ? 'expired' : 'failed';
  state.error = reason.slice(0, 300);
  save();
  process.exit(1);
});

// Backstop for a flow that never produces a URL.
setTimeout(() => {
  if (state.status === 'starting') {
    finish({ status: 'failed', error: 'timed out waiting for the sign-in link' });
  }
}, 2 * 60 * 1000);

// Cleanup backstop for an abandoned flow.
setTimeout(
  () => finish({ status: 'expired', error: 'sign-in expired' }),
  ${FLOW_TTL_MS},
);
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type VmRef = ReturnType<ReturnType<typeof getFreestyle>['vms']['ref']>;

async function readState(vm: VmRef): Promise<ClaudeLoginFileState | null> {
  try {
    return JSON.parse(await vm.fs.readTextFile(STATE_PATH));
  } catch {
    return null; // no flow started (or VM still waking) — both read as "none"
  }
}

/**
 * (Re)start the login flow on the user's VM and return the sign-in URL.
 * Restarting is always safe: any previous helper (and its claude process)
 * is killed first, so at most one login flow runs per VM.
 */
export async function startClaudeLogin(
  vmId: string,
): Promise<ClaudeAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });

  await vm.exec(`mkdir -p ${DIR}`);
  await vm.fs.writeTextFile(HELPER_PATH, HELPER_SOURCE);
  // [c]laude: the bracket trick keeps pkill from matching this very shell.
  await vm.exec(
    `pkill -f '[c]laude-device-login'; pkill -f '[c]laude auth login'; ` +
      `rm -f ${STATE_PATH} ${CODE_DROP_PATH}; true`,
  );
  await vm.exec(`nohup node ${HELPER_PATH} > ${LOG_PATH} 2>&1 & echo $!`);

  // The URL is generated locally by the CLI — should appear fast.
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    const state = await readState(vm);
    if (!state || state.status === 'starting') continue;
    if (state.status === 'pending') {
      return { status: 'pending', verificationUrl: state.verificationUrl };
    }
    throw new Error(state.error ?? `login ${state.status}`);
  }
  throw new Error('timed out waiting for the sign-in link');
}

/**
 * Forward the code the user pasted (from Anthropic's OAuth page) to the
 * CLI waiting on the VM. Returns the still-`pending` status; completion is
 * observed via the status endpoint as the CLI finishes the exchange.
 */
export async function submitClaudeLoginCode(
  vmId: string,
  code: string,
): Promise<ClaudeAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });
  const state = await readState(vm);
  if (state?.status !== 'pending') {
    return { status: 'failed', error: 'No sign-in in progress. Start over.' };
  }
  await vm.fs.writeTextFile(CODE_DROP_PATH, code.trim());
  return {
    status: 'pending',
    verificationUrl: state.verificationUrl,
  };
}

/**
 * Where the VM's claude auth stands. `claude auth status` reports JSON
 * (`loggedIn`) and exits non-zero when signed out; the state file adds
 * detail for in-flight and failed flows.
 */
export async function getClaudeAuthStatus(
  vmId: string,
): Promise<ClaudeAuthStatus> {
  const vm = getFreestyle().vms.ref({ vmId });
  const state = await readState(vm);

  if (state?.status === 'starting' || state?.status === 'pending') {
    return {
      status: 'pending',
      verificationUrl: state.verificationUrl,
      // A rejected paste surfaces here so the UI can re-open the input.
      error: state.error,
    };
  }

  const check = await vm.exec({
    command: 'claude auth status 2>&1',
    timeoutMs: 30_000,
  });
  if (check.statusCode === 0 && /"loggedIn":\s*true/.test(check.stdout ?? '')) {
    return { status: 'connected' };
  }

  if (state?.status === 'failed' || state?.status === 'expired') {
    return { status: state.status, error: state.error };
  }
  return { status: 'disconnected' };
}
