#!/usr/bin/env node
// Smoke test against the deployed Worker. Provisions a real (anonymous)
// user + Freestyle VM, then sends one agent prompt. With no provider
// signed in on the fresh VM the turn must settle as FAILED with the
// "not signed in" message — which proves the full production pipeline:
// Worker → VM wake → daemon install/boot → sync → agent spawn → settle →
// poll. Pass SERVER_URL to point elsewhere.
//
// Run from apps/server:  node scripts/prod-smoke.mjs

const SERVER = (
  process.env.SERVER_URL ?? 'https://web-butler-api.swerdlowbenjamin.workers.dev'
).replace(/\/$/, '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const health = await fetch(`${SERVER}/health`);
console.log('health:', health.status, await health.text());
if (!health.ok) process.exit(1);

const signin = await fetch(`${SERVER}/api/auth/sign-in/anonymous`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const token = signin.headers.get('set-auth-token');
console.log('anonymous sign-in:', signin.status, token ? '(token ok)' : '(NO TOKEN)');
if (!signin.ok || !token) process.exit(1);

const authed = (path, init = {}) =>
  fetch(`${SERVER}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

console.log('init (provisions a Freestyle VM)…');
const initRes = await authed('/api/init', { method: 'POST' });
const init = await initRes.json();
console.log('init:', initRes.status, JSON.stringify(init));
if (!initRes.ok) process.exit(1);

console.log('prompt (wakes + installs the daemon on the VM)…');
const started = Date.now();
const enqueue = await authed('/api/agent/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'codex',
    prompt: 'Smoke test: say hello.',
    taskId: crypto.randomUUID(),
  }),
});
const body = await enqueue.json();
console.log('enqueue:', enqueue.status, JSON.stringify(body));
if (!enqueue.ok) process.exit(1);

let since = 0;
let updates = 0;
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  await sleep(2000);
  const poll = await authed(`/api/agent/turn/${body.turn}?since=${since}`);
  if (!poll.ok) {
    console.log('poll failed:', poll.status);
    continue;
  }
  const data = await poll.json();
  for (const batch of data.updates ?? []) {
    since = Math.max(since, batch.seq);
    updates += batch.updates.length;
  }
  if (data.status !== 'queued' && data.status !== 'running') {
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `turn settled: ${data.status} after ${seconds}s (${updates} updates)`,
    );
    if (data.status === 'failed') console.log('error:', data.error);
    if (data.status === 'done') console.log('text:', (data.text ?? '').slice(0, 200));
    const expected =
      data.status === 'failed' && /not signed in/i.test(data.error ?? '');
    console.log(
      expected
        ? '\nSMOKE PASS: pipeline is live (turn failed only on provider auth, as expected)'
        : data.status === 'done'
          ? '\nSMOKE PASS: turn completed'
          : '\nSMOKE UNEXPECTED: check the error above',
    );
    process.exit(expected || data.status === 'done' ? 0 : 1);
  }
}
console.log('SMOKE FAIL: turn did not settle within 3 minutes');
process.exit(1);
