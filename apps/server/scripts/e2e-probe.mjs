#!/usr/bin/env node
// Local end-to-end probe for the daemon-based turn engine. Exercises the
// full production topology on one machine, no Freestyle and no extension:
//
//   probe (plays the extension) ── HTTP ──> server (Node entrypoint,
//   WB_LOCAL_VM=1 so no Freestyle calls) <── HTTP ── daemon.mjs (spawned
//   here with WB_WORKSPACE/WB_DAEMON_DIR pointing at a temp dir), which
//   spawns fake-acp-agent.mjs exactly like it spawns provider CLIs.
//
// Asserts three flows: a plain turn (updates + outcome file), a browser
// action roundtrip (mailbox → sync → poll → action-result → res file),
// and cancel. Uses the real database from apps/server/.env.
//
// Run from apps/server:  node scripts/e2e-probe.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8788;
const SERVER = `http://localhost:${PORT}`;

process.loadEnvFile(join(SERVER_DIR, '.env'));

const children = [];
const cleanupDirs = [];
let failed = false;

function die(message) {
  console.error(`\nFAIL: ${message}`);
  failed = true;
  shutdown();
}

function shutdown() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  process.exit(failed ? 1 : 0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function launch(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const tag = (chunk) =>
    String(chunk)
      .trim()
      .split('\n')
      .forEach((line) => console.log(`  [${name}] ${line}`));
  child.stdout.on('data', tag);
  child.stderr.on('data', tag);
  child.on('exit', (code) => console.log(`  [${name}] exited (${code})`));
  children.push(child);
  return child;
}

// --- 1. Server ---------------------------------------------------------------

console.log('starting server…');
launch('server', 'npx', ['tsx', 'src/index.ts'], {
  PORT: String(PORT),
  WB_LOCAL_VM: '1',
  WB_FAKE_AGENT_CMD: `exec node ${join(SERVER_DIR, 'scripts', 'fake-acp-agent.mjs')}`,
  BETTER_AUTH_URL: SERVER,
});

let up = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    const response = await fetch(`${SERVER}/health`);
    if (response.ok) {
      up = true;
      break;
    }
  } catch {
    /* not yet */
  }
}
if (!up) die('server did not come up on ' + SERVER);
console.log('server is up');

// --- 2. Session + sandbox ------------------------------------------------------

const signin = await fetch(`${SERVER}/api/auth/sign-in/anonymous`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const token = signin.headers.get('set-auth-token');
if (!signin.ok || !token) die(`anonymous sign-in failed: ${signin.status}`);
const authed = (path, init = {}) =>
  fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });

const init = await (await authed('/api/init', { method: 'POST' })).json();
if (!init.sandbox?.vmId?.startsWith('local-')) {
  die(`init did not produce a local sandbox: ${JSON.stringify(init)}`);
}
console.log('sandbox:', init.sandbox.vmId);

// --- 3. Daemon -----------------------------------------------------------------

// The daemon authenticates by token; fish it out of the DB directly.
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const [sandboxRow] = await sql`
  SELECT daemon_token FROM sandbox WHERE vm_id = ${init.sandbox.vmId}
`;
if (!sandboxRow?.daemon_token) die('no daemon token on the sandbox row');

const root = mkdtempSync(join(tmpdir(), 'wb-probe-'));
cleanupDirs.push(root);
const daemonDir = join(root, 'opt');
const workspace = join(root, 'workspace');
mkdirSync(daemonDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(
  join(daemonDir, 'daemon.json'),
  JSON.stringify({ serverUrl: SERVER, token: sandboxRow.daemon_token }),
);

console.log('starting daemon…');
launch('daemon', 'node', ['vm-daemon/daemon.mjs'], {
  WB_DAEMON_DIR: daemonDir,
  WB_WORKSPACE: workspace,
});

// --- 4. Turn 1: plain response ---------------------------------------------------

async function runTurn(prompt, { onActions } = {}) {
  const enqueue = await authed('/api/agent/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'codex',
      prompt,
      taskId: crypto.randomUUID(),
      page: {
        url: 'https://example.com/probe',
        title: 'Probe page',
        html: '<main>probe</main>',
      },
    }),
  });
  const body = await enqueue.json();
  if (!enqueue.ok || typeof body.turn !== 'string') {
    throw new Error(`prompt enqueue failed: ${JSON.stringify(body)}`);
  }
  console.log('turn enqueued:', body.turn);

  let since = 0;
  const updates = [];
  const answered = new Set();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(700);
    const poll = await authed(`/api/agent/turn/${body.turn}?since=${since}`);
    if (!poll.ok) throw new Error(`poll failed: ${poll.status}`);
    const data = await poll.json();
    for (const batch of data.updates ?? []) {
      since = Math.max(since, batch.seq);
      updates.push(...batch.updates);
    }
    for (const action of data.actions ?? []) {
      if (answered.has(action.id)) continue;
      answered.add(action.id);
      if (onActions) await onActions(action);
    }
    if (data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') {
      return { ...data, allUpdates: updates, turnId: body.turn };
    }
  }
  throw new Error('turn did not settle within 90s');
}

try {
  console.log('\n--- turn 1: plain response ---');
  const turn1 = await runTurn('Say hello, please.');
  if (turn1.status !== 'done') {
    throw new Error(`turn 1 settled ${turn1.status}: ${turn1.error}`);
  }
  if (!turn1.text.includes('Hello from the fake agent')) {
    throw new Error(`unexpected reply text: ${turn1.text}`);
  }
  const response = (turn1.outcomes ?? []).find((o) => o.type === 'response');
  if (!response?.markdown?.includes('Hello from the fake agent')) {
    throw new Error(`outcome file not honored: ${JSON.stringify(turn1.outcomes)}`);
  }
  if (turn1.allUpdates.length === 0) {
    throw new Error('no streamed updates arrived');
  }
  console.log(
    `PASS  (${turn1.allUpdates.length} updates, outcome: ${response.markdown.slice(0, 60)})`,
  );

  console.log('\n--- turn 2: browser action roundtrip ---');
  const turn2 = await runTurn(
    'Please check the page. PROBE_BROWSER_ACTION',
    {
      onActions: async (action) => {
        console.log('  action requested:', JSON.stringify(action));
        if (action.kind !== 'read') throw new Error(`unexpected action ${action.kind}`);
        const post = await authed('/api/agent/action-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: action.id,
            result: { ok: true, data: 'PROBE PAGE CONTENT' },
          }),
        });
        const out = await post.json();
        if (!out.delivered) throw new Error('action result not delivered');
      },
    },
  );
  if (turn2.status !== 'done') {
    throw new Error(`turn 2 settled ${turn2.status}: ${turn2.error}`);
  }
  if (!turn2.text.includes('PROBE PAGE CONTENT')) {
    throw new Error(`action result did not reach the agent: ${turn2.text}`);
  }
  console.log('PASS  (action answered and echoed back through the agent)');

  console.log('\n--- turn 3: cancel ---');
  // PROBE_BROWSER_ACTION with no one answering = the agent hangs waiting →
  // a reliably long-running turn to cancel.
  const taskId = crypto.randomUUID();
  const enqueue = await authed('/api/agent/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'codex',
      prompt: 'Hang around. PROBE_BROWSER_ACTION',
      taskId,
    }),
  });
  const { turn: turn3Id } = await enqueue.json();
  await sleep(4000); // let the daemon pick it up
  await authed('/api/agent/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  let final = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const poll = await authed(`/api/agent/turn/${turn3Id}?since=0`);
    const data = await poll.json();
    if (data.status !== 'queued' && data.status !== 'running') {
      final = data;
      break;
    }
  }
  if (!final) throw new Error('cancelled turn never settled');
  console.log(`PASS  (turn settled as ${final.status})`);

  console.log('\nAll probes passed.');
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

shutdown();
