/**
 * Browser control: letting the agent drive the user's actual browser tab
 * through a visible "ghost cursor", for tasks like filling a form or
 * composing an email in place.
 *
 * The hard constraint is the topology: the agent runs on a sandbox VM that
 * cannot reach the user's machine, and the only live channel we have is the
 * NDJSON response stream of the in-flight `/api/agent/prompt` request
 * (server → extension). So the loop is a file mailbox on the VM:
 *
 *   1. The agent runs the `browser` CLI (written to the VM by acp.ts). It
 *      writes a request JSON into ACTIONS_DIR and blocks on a response file.
 *   2. While the prompt turn runs, the route polls ACTIONS_DIR (drainActions),
 *      relays each new request to the extension as an `{action}` stream line,
 *      and parks a resolver here keyed by the action id.
 *   3. The extension performs it with chrome.debugger + the ghost cursor and
 *      POSTs the result to /api/agent/action-result, which resolves the
 *      parked promise.
 *   4. drainActions writes the response file; the CLI unblocks and prints it.
 *
 * This module owns the VM-side artifacts (CLI source, skill), the wire
 * schema, and the in-memory request registry the two routes share.
 */

import { z } from 'zod';
import { getFreestyle } from './freestyle';
import { WORKSPACE_DIR } from './vm-paths';

/** Root of the action mailboxes. Each task's agent process gets its own
    subdirectory (WB_ACTIONS_DIR in its env — see acp.ts's bootstrap), so
    concurrent tasks never drain each other's requests. */
export const ACTIONS_DIR = `${WORKSPACE_DIR}/.butler/actions`;

/** Where the browser-control authoring skill lands (briefing points here). */
export const BROWSER_SKILL_PATH = `${WORKSPACE_DIR}/skills/browser-control/SKILL.md`;

/** The `browser` CLI, symlinked onto PATH by acp.ts. */
export const BROWSER_CLI_PATH = `${WORKSPACE_DIR}/.butler/browser.mjs`;

export const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('tabs') }),
  z.object({ id: z.string(), kind: z.literal('snapshot') }),
  z.object({ id: z.string(), kind: z.literal('read') }),
  z.object({ id: z.string(), kind: z.literal('navigate'), url: z.string() }),
  z.object({ id: z.string(), kind: z.literal('back') }),
  z.object({ id: z.string(), kind: z.literal('click'), ref: z.string() }),
  z.object({
    id: z.string(),
    kind: z.literal('type'),
    ref: z.string(),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({ id: z.string(), kind: z.literal('key'), key: z.string() }),
  z.object({ id: z.string(), kind: z.literal('scroll'), dy: z.number() }),
  z.object({
    id: z.string(),
    kind: z.literal('network'),
    filter: z.string().optional(),
  }),
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;

export type BrowserActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Request registry: shared by the stream route (parks a resolver, awaits the
// extension) and the action-result route (resolves it). Ids are uuids from
// the CLI, so cross-user collision isn't a concern on a single dev server.
// ---------------------------------------------------------------------------

const pending = new Map<string, (result: BrowserActionResult) => void>();

/** Park a resolver for `id`; the action-result route fulfills it. Rejects
    with a timeout result if the extension never answers. */
export function awaitBrowserAction(
  id: string,
  timeoutMs: number,
): Promise<BrowserActionResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'the browser action timed out' });
    }, timeoutMs);
    pending.set(id, (result) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(result);
    });
  });
}

/** Fulfil a parked action (called by /api/agent/action-result). */
export function resolveBrowserAction(
  id: string,
  result: BrowserActionResult,
): boolean {
  const resolve = pending.get(id);
  if (!resolve) return false;
  resolve(result);
  return true;
}

// ---------------------------------------------------------------------------
// Draining the VM mailbox during a turn.
// ---------------------------------------------------------------------------

/** Delimiter between request blocks in the batched cat (see drainActions).
    Plain ASCII on purpose: a NUL byte here corrupts the command sent to the
    VM, and this token won't appear inside a JSON action body. */
const SEP = '<<<WBSEP>>>';

/**
 * One poll of a task's action mailbox: for every request file without a
 * response and not already handled this turn, relay it via `onAction` and
 * write the response file that unblocks the CLI. Sequential by design —
 * the CLI only ever has one action outstanding, and pacing the ghost
 * cursor is slow.
 */
export async function drainActions(
  vmId: string,
  actionsDir: string,
  handled: Set<string>,
  onAction: (action: BrowserAction) => Promise<BrowserActionResult>,
): Promise<void> {
  const vm = getFreestyle().vms.ref({ vmId });
  // One shell round-trip lists + cats every unanswered request, id-tagged.
  const script =
    `cd ${actionsDir} 2>/dev/null || exit 0; ` +
    'for f in *.req.json; do ' +
    '[ -e "$f" ] || continue; id=${f%.req.json}; ' +
    '[ -e "$id.res.json" ] && continue; ' +
    `printf '%s' "$id"; printf '${SEP}'; cat "$f"; printf '${SEP}'; ` +
    'done';
  const result = await vm.exec({ command: script, timeoutMs: 15_000 });
  const stdout = result.stdout ?? '';
  if (!stdout) return;

  const parts = stdout.split(SEP);
  // parts: [id0, body0, id1, body1, …, ''] — step in pairs.
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const id = parts[i].trim();
    if (!id || handled.has(id)) continue;
    handled.add(id);
    let result_: BrowserActionResult;
    const parsed = browserActionSchema.safeParse(
      JSON.parse(parts[i + 1] || 'null'),
    );
    if (!parsed.success) {
      result_ = { ok: false, error: 'malformed browser action' };
    } else {
      try {
        result_ = await onAction(parsed.data);
      } catch (error) {
        result_ = {
          ok: false,
          error: error instanceof Error ? error.message : 'action failed',
        };
      }
    }
    // Unblock the CLI. Written last so the CLI never reads a partial file.
    await vm.fs.writeTextFile(
      `${actionsDir}/${id}.res.json`,
      JSON.stringify(result_),
    );
  }
}

// ---------------------------------------------------------------------------
// VM-side artifacts.
// ---------------------------------------------------------------------------

/**
 * The `browser` CLI, written to the VM. Dependency-free Node: builds a
 * request from argv, drops it in the mailbox, and blocks on the response
 * file using Atomics (no busy-spin, no child processes). Prints the
 * result's `data` as JSON on success; the error on stderr with exit 1.
 */
export const BROWSER_CLI = `#!/usr/bin/env node
// Web Butler browser-control CLI. Talks to the extension via a file mailbox
// the server drains during the current turn. See browser-tool.ts.
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Per-task mailbox: the agent process exports WB_ACTIONS_DIR (acp.ts) and
// tool subprocesses inherit it, so each task talks to its own drain loop.
const DIR = process.env.WB_ACTIONS_DIR || ${JSON.stringify(ACTIONS_DIR)};
const TIMEOUT_MS = 60_000;
const sab = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { Atomics.wait(sab, 0, 0, ms); };

function usage() {
  console.error(
    'usage: browser <command>\\n' +
    '  tabs                       list open tabs\\n' +
    '  snapshot                   list interactive elements (with refs) on the active tab\\n' +
    '  read                       read the visible text of the active tab\\n' +
    '  network [filter]           recent XHR/fetch calls on the active tab (method, status, url, bodies); [filter] = url substring, or "all" for every request\\n' +
    '  navigate <url>             go to a URL\\n' +
    '  back                       go back one page\\n' +
    '  click <ref>                click the element with that ref\\n' +
    '  type <ref> <text...>       focus the element and type text\\n' +
    '  type --submit <ref> <text> type then press Enter\\n' +
    '  key <Key>                  press a key (Enter, Tab, Escape, ArrowDown…)\\n' +
    '  scroll <dy>                scroll vertically by dy pixels (negative = up)',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (!cmd) usage();

const id = randomUUID();
let action;
try {
  if (cmd === 'tabs') action = { id, kind: 'tabs' };
  else if (cmd === 'snapshot') action = { id, kind: 'snapshot' };
  else if (cmd === 'read') action = { id, kind: 'read' };
  else if (cmd === 'network') action = { id, kind: 'network', filter: argv[1] };
  else if (cmd === 'navigate') action = { id, kind: 'navigate', url: argv[1] };
  else if (cmd === 'back') action = { id, kind: 'back' };
  else if (cmd === 'click') action = { id, kind: 'click', ref: argv[1] };
  else if (cmd === 'key') action = { id, kind: 'key', key: argv[1] };
  else if (cmd === 'scroll') action = { id, kind: 'scroll', dy: Number(argv[1]) };
  else if (cmd === 'type') {
    let rest = argv.slice(1);
    let submit = false;
    if (rest[0] === '--submit') { submit = true; rest = rest.slice(1); }
    action = { id, kind: 'type', ref: rest[0], text: rest.slice(1).join(' '), submit };
  } else usage();
} catch {
  usage();
}

mkdirSync(DIR, { recursive: true });
const req = DIR + '/' + id + '.req.json';
const res = DIR + '/' + id + '.res.json';
writeFileSync(req, JSON.stringify(action));

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  if (existsSync(res)) {
    const result = JSON.parse(readFileSync(res, 'utf8'));
    try { rmSync(req); rmSync(res); } catch {}
    if (result && result.ok) {
      const data = result.data;
      process.stdout.write(
        typeof data === 'string' ? data : JSON.stringify(data ?? { ok: true }, null, 2),
      );
      process.stdout.write('\\n');
      process.exit(0);
    }
    console.error((result && result.error) || 'browser action failed');
    process.exit(1);
  }
  sleep(200);
}
try { rmSync(req); } catch {}
console.error('browser action timed out (no response from the extension)');
process.exit(1);
`;

export const BROWSER_TOOL_SKILL = `# Controlling the browser

Some tasks happen IN the user's tab rather than in a write-up: filling a form, composing an email, stepping through a checkout, or exploring a site by clicking through its pages. For those you drive the user's real browser tab through the \`browser\` command — it moves a visible cursor and clicks/types like a person, and the user watches it happen on their screen. That visible motion is part of the point: when someone says "explore this site" or "walk through the signup flow", they want to SEE you move around, so use the browser rather than answering from memory.

The one time NOT to use it: a plain question about the page the user is already on ("what does this say?", "summarize this article"). The page HTML snapshot in the envelope already answers that — don't drive the cursor just to look at the current page.

## The loop

Work against a fresh snapshot, act, then re-snapshot:

1. \`browser snapshot\` — prints the current URL and title, then the interactive elements on the active tab, each with a stable \`ref\` (like \`e12\`), its role, accessible name, and current value. This is your map of the page.
2. Act on refs from the LATEST snapshot: \`browser click e12\`, \`browser type e5 jane@example.com\`.
3. Anything changed the page — a click that navigated, a new field, an opened menu, a \`navigate\`? Take a new \`browser snapshot\`. Refs are only valid until the next snapshot; never reuse one from an older snapshot.

## Exploring a site

To explore or map a site: navigate (or click a link), \`browser read\` to take in the page's text, note what's there, then click through to the next page. Use \`browser back\` to return and try another branch. Move deliberately — a few representative pages beats clicking everything — and keep a running sense of the structure so your final outcome can describe it. The user is watching the cursor travel, so this doubles as a demonstration.

## Investigating how a page works, then building on it

The debugger sees the page's network traffic, which is often the shortest path to understanding — and then extending — a site. When a request is "build me a button that does X" or "show me Y inline", investigate first, then author a page extension (see the page-extension skill) that talks to the same API:

1. Load or interact with the page so it makes its real requests (\`browser navigate\`, or \`browser click\` the thing that triggers the call).
2. \`browser network\` — read the XHR/fetch calls: the endpoint URLs, methods, what the request bodies carry, and what the responses look like. Filter to the interesting one (\`browser network graphql\`).
3. Now you know the contract. Author an extension whose script calls that endpoint with \`page.fetch(url, options)\` (it runs in the background with the extension's host permissions, so cross-origin and the site's own cookies both work) and renders the result — a button that fires the call, a panel of live data, an inline field the page was missing.

So the pattern is: drive the browser to LEARN (network + read), then produce an \`extension\` outcome to BUILD. The investigation is throwaway; the extension is the deliverable.

## Commands

- \`browser tabs\` — list the user's open tabs (id, title, url). The cursor acts on the active one.
- \`browser snapshot\` — current URL/title + the ref map of the active tab. Start here and re-run after every change.
- \`browser read\` — the visible text of the active tab, for taking in a page's content while exploring or verifying a change.
- \`browser network [filter]\` — the tab's recent network traffic, captured live by the debugger: each XHR/fetch call's method, status, URL, and request/response body preview. This is how you discover the API a page actually speaks. Pass a URL substring to filter (\`browser network api/search\`); pass \`all\` to include non-XHR requests too.
- \`browser navigate <url>\` — load a URL in the active tab.
- \`browser back\` — go back one page in history.
- \`browser click <ref>\` — move the cursor to that element and click it (this is how you follow links too).
- \`browser type <ref> <text>\` — focus that field and type. Add \`--submit\` before the ref to press Enter after (\`browser type --submit e5 hello\`).
- \`browser key <Key>\` — press a single key: \`Enter\`, \`Tab\`, \`Escape\`, \`ArrowDown\`, etc.
- \`browser scroll <dy>\` — scroll by dy pixels (negative scrolls up) to bring elements into view.

## Rules

1. One snapshot, then a few actions, then re-snapshot. The page is a moving target; a ref map goes stale the instant the DOM changes.
2. Type real values, not placeholders. If the task doesn't give you a value a field needs and you can't infer it safely, stop and ask in your outcome rather than inventing personal data.
3. Never do anything irreversible (place an order, send a message, confirm a payment, delete something) unless the user explicitly asked for that exact step. Set everything up, then leave the final confirmation to them and say so in your outcome.
4. If a ref won't click or a field won't focus, re-snapshot — it likely moved. Don't hammer the same ref.
5. Give navigations a moment: after a click that loads a new page or a \`navigate\`, your next \`snapshot\`/\`read\` sees the new page. If it looks half-loaded, snapshot once more.
6. When you're done, write your outcome as usual: a short \`response\` for a task ("filled the form, left the final Submit to you"), or an \`artifact\` when exploration produced something worth keeping (a site map, a walkthrough). The browser actions are the work; the outcome is the report on it.
`;
