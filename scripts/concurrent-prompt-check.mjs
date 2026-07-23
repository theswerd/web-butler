// Concurrency check for POST /api/agent/prompt: two prompts with DIFFERENT
// task ids must run at the same time (each gets its own ACP bridge + PTY on
// the one VM) and settle independently — neither cancels the other. On a
// fresh VM no provider is signed in, so both terminal lines are the "not
// signed in" error; what matters is that BOTH arrive, and that the streams
// overlapped in time.
import { neon } from '@neondatabase/serverless';

const SERVER = 'http://localhost:8787';

const signIn = await fetch(`${SERVER}/api/auth/sign-in/anonymous`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const token = signIn.headers.get('set-auth-token');
if (!token) throw new Error('no auth token from anonymous sign-in');

const authed = (path, init) =>
  fetch(`${SERVER}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });

const init = await (await authed('/api/init', { method: 'POST' })).json();
const vmId = init.sandbox?.vmId;
console.log('sandbox vm:', vmId);

async function runTurn(label, taskId) {
  const started = Date.now();
  const response = await authed('/api/agent/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'grok',
      prompt: 'Reply with exactly: PONG',
      taskId,
    }),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const parsed = JSON.parse(line);
      if (parsed.error || parsed.done) terminal = parsed;
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[${label}] terminal after ${seconds}s:`,
    JSON.stringify(terminal).slice(0, 140),
  );
  return { finishedAt: Date.now(), terminal };
}

try {
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    runTurn('task-A', crypto.randomUUID()),
    runTurn('task-B', crypto.randomUUID()),
  ]);
  const total = ((Math.max(a.finishedAt, b.finishedAt) - t0) / 1000).toFixed(1);
  console.log('both terminals arrived:', a.terminal != null && b.terminal != null);
  console.log(`wall time for both: ${total}s (serial would be ~2x one turn)`);
} finally {
  if (vmId && process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM sandbox WHERE vm_id = ${vmId}`;
    console.log('sandbox row removed; delete the VM via freestyle:', vmId);
  }
}
