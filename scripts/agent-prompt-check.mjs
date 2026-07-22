// Plumbing check for POST /api/agent/prompt: anonymous sign-in → init
// (fresh VM) → one prompt turn per provider. On a fresh VM no provider is
// signed in, so the expected terminal line is the "not signed in" error —
// which still exercises the whole path: route → ACP bridge → PTY → agent
// process (and for codex/claude, the lazy adapter install).
//
//   node scripts/agent-prompt-check.mjs [provider ...]   (default: grok)
import { neon } from '@neondatabase/serverless';

const SERVER = 'http://localhost:8787';
const providers = process.argv.slice(2).length ? process.argv.slice(2) : ['grok'];

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

try {
  for (const provider of providers) {
    console.log(`\n--- ${provider} ---`);
    const started = Date.now();
    const response = await authed('/api/agent/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, prompt: 'Reply with exactly: PONG' }),
    });
    console.log('status:', response.status, response.headers.get('content-type'));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) console.log(' ', line.slice(0, 200));
      }
    }
    console.log(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
} finally {
  // Test identity → test VM; clean up both sides.
  if (vmId && process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM sandbox WHERE vm_id = ${vmId}`;
    console.log('\nsandbox row removed; delete the VM via freestyle:', vmId);
  }
}
