// Protocol probe for the detached-turn stream client (lib/server.ts).
// Bundles the REAL runAgentPrompt/attachAgentTurn and runs them against a
// scripted mock server that speaks the new job protocol:
//
//   1. POST /api/agent/prompt announces {"job"}, streams two seq'd updates,
//      then hard-cuts the socket mid-turn (worker death / network loss).
//      The client must surface a transport error, having reported the job
//      id and the last seq it saw.
//   2. GET /api/agent/attach?job&since must arrive with the right cursor;
//      the mock replays the missed update, re-delivers a pending browser
//      action, then sends the terminal line WITHOUT closing the stream —
//      the client must settle on the terminal line by itself and must POST
//      the action's result back.
//   3. Attaching to an unknown job must yield the TURN_GONE sentinel.
//
// Run: node scripts/turn-stream-probe.mjs
import { build } from 'esbuild';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const PORT = 8791;

// --- Bundle the real client module with test stubs -------------------------

const outDir = mkdtempSync(join(tmpdir(), 'wb-turn-probe-'));
const outFile = join(outDir, 'server-lib.mjs');

await build({
  entryPoints: [join(root, 'apps/extension/lib/server.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  alias: {
    'wxt/utils/storage': join(root, 'scripts/wxt-storage-stub.mjs'),
  },
});
// The module hardcodes the dev server origin; point it at the mock.
writeFileSync(
  outFile,
  readFileSync(outFile, 'utf8').replaceAll(
    'http://localhost:8787',
    `http://localhost:${PORT}`,
  ),
);

const lib = await import(pathToFileURL(outFile).href);
const { runAgentPrompt, attachAgentTurn, isTransportError, TURN_GONE_ERROR } =
  lib;

// --- Mock server ------------------------------------------------------------

const seen = {
  attachQuery: null,
  actionResult: null,
};

const line = (payload) => JSON.stringify(payload) + '\n';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/auth/sign-in/anonymous') {
    res.writeHead(200, { 'set-auth-token': 'probe-token' });
    res.end('{}');
  } else if (url.pathname === '/api/init') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sandbox: { vmId: 'vm-probe', created: false } }));
  } else if (url.pathname === '/api/agent/prompt') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(line({ job: 'job-1' }));
    res.write(
      line({
        seq: 1,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { text: 'a' },
        },
      }),
    );
    res.write(
      line({
        seq: 2,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { text: 'b' },
        },
      }),
    );
    // Mid-turn death: no terminal line, connection just goes away.
    setTimeout(() => res.destroy(), 150);
  } else if (url.pathname === '/api/agent/attach') {
    if (url.searchParams.get('job') !== 'job-1') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no such turn' }));
      return;
    }
    seen.attachQuery = Object.fromEntries(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    // Replay what the cursor missed, re-deliver a pending action, then the
    // terminal — and DON'T close: the client must settle on the terminal
    // line itself.
    res.write(
      line({
        seq: 3,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { text: 'c' },
        },
      }),
    );
    res.write(line({ action: { id: 'act-1', kind: 'tabs' } }));
    res.write(
      line({
        seq: 4,
        done: true,
        stopReason: 'end_turn',
        text: 'final answer',
        outcomes: [{ type: 'response', markdown: 'final answer' }],
      }),
    );
  } else if (url.pathname === '/api/agent/action-result') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.actionResult = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ delivered: true }));
    });
  } else {
    res.writeHead(404);
    res.end('{}');
  }
});

await new Promise((r) => server.listen(PORT, r));

// --- Scenario ----------------------------------------------------------------

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
};

// 1. The POST turn dies mid-stream.
let jobId;
let lastSeq = 0;
const updates = [];
const turn1 = await runAgentPrompt({
  provider: 'codex',
  prompt: 'probe',
  onJob: (id) => (jobId = id),
  onSeq: (seq) => (lastSeq = seq),
  onUpdate: (update) => updates.push(update),
});

check('cut stream surfaces an error', 'error' in turn1, JSON.stringify(turn1));
check(
  'error is classified as transport (retryable)',
  'error' in turn1 && isTransportError(turn1.error),
  turn1.error,
);
check('job id announced before the cut', jobId === 'job-1', String(jobId));
check('seq cursor tracked', lastSeq === 2, String(lastSeq));
check('updates before the cut delivered', updates.length === 2, String(updates.length));

// 2. Re-attach from the cursor; expect replay + action + self-settling terminal.
const turn2 = await attachAgentTurn({
  jobId,
  since: lastSeq,
  onSeq: (seq) => (lastSeq = seq),
  onUpdate: (update) => updates.push(update),
  onAction: async (action) => ({ ok: true, data: `did:${action.kind}` }),
});

check(
  'attach carried the cursor',
  seen.attachQuery?.job === 'job-1' && seen.attachQuery?.since === '2',
  JSON.stringify(seen.attachQuery),
);
check(
  'terminal outcome parsed without server close',
  'text' in turn2 && turn2.text === 'final answer',
  JSON.stringify(turn2),
);
check('missed update replayed', updates.length === 3, String(updates.length));
check('cursor advanced to terminal', lastSeq === 4, String(lastSeq));

// The action result rides back on its own request — give it a beat.
await new Promise((r) => setTimeout(r, 300));
check(
  'pending action performed and result POSTed',
  seen.actionResult?.id === 'act-1' && seen.actionResult?.result?.ok === true,
  JSON.stringify(seen.actionResult),
);

// 3. Unknown job → the gone sentinel, not a generic error.
const turn3 = await attachAgentTurn({ jobId: 'job-unknown', since: 0 });
check(
  'unknown job yields TURN_GONE',
  'error' in turn3 && turn3.error === TURN_GONE_ERROR,
  JSON.stringify(turn3),
);

server.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
