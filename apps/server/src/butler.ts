import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getFreestyle } from './freestyle';
import { WORKSPACE_DIR } from './acp';

/**
 * The Web Butler contract between us and the agent CLIs.
 *
 * Three pieces, all plain text over ACP:
 *  - BUTLER_BRIEFING: who the agent is and how turns work. Sent once, at
 *    the top of the first message of every fresh ACP session.
 *  - buildTurnMessage: the envelope around every user message: the page
 *    they're on (URL, title, HTML snapshot), any elements they selected,
 *    and the outcome-file path for this turn.
 *  - readOutcomes: after the turn ends, the outcome file is read off the
 *    VM and validated. The agent declares what it produced there: a short
 *    markdown response or a long-form artifact (extensions and actions
 *    will join this union later). A missing or malformed file falls back
 *    to the streamed reply text as a plain response, flagged (fileMissing
 *    or invalid) so the prompt route can push back rather than present
 *    undeclared work as done.
 */

/** Where turn outcome files land on the VM. Created by the ACP prep step. */
export const OUTCOME_DIR = `${WORKSPACE_DIR}/.butler`;

/**
 * Where the user's stored work is mirrored onto the VM so the agent can
 * READ it: each installed extension's current script and each past
 * report's markdown. The envelope lists these paths; merging or updating
 * an extension starts with reading its current source, and "like that
 * report from earlier" starts with reading the report.
 */
export const CONTEXT_DIR = `${OUTCOME_DIR}/context`;

/** VM path of one installed extension's current script. */
export function extensionSourcePath(id: string): string {
  return `${CONTEXT_DIR}/extensions/${id}.js`;
}

/** VM path of one past report's markdown. */
export function reportSourcePath(id: string): string {
  return `${CONTEXT_DIR}/reports/${id}.md`;
}

const selectedElementSchema = z.object({
  /** CSS path, resolvable on the page at pick time. */
  selector: z.string(),
  /** Short human label, e.g. 'button.sidebar-btn'. */
  label: z.string(),
  tag: z.string(),
  /** Trimmed visible text at pick time. */
  text: z.string().optional(),
  /** outerHTML captured at pick time (size-capped by the extension). */
  html: z.string(),
  /** True when the element has since left the page. */
  missing: z.boolean().optional(),
});

export const pageContextSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  /** DOM snapshot, scripts/styles stripped and size-capped client-side. */
  html: z.string().max(400_000).optional(),
  /** Elements the user explicitly referenced via the picker. */
  selection: z.array(selectedElementSchema).max(20).optional(),
});

export type PageContext = z.infer<typeof pageContextSchema>;

export const extensionStageSchema = z.enum([
  'document_start',
  'document_end',
  'document_idle',
]);

// The schema is deliberately forgiving about the slips agents actually
// make (null for a missing id, a bare string where an array belongs,
// over-long user-facing copy). Every outcome we can salvage is one the
// user doesn't lose; genuine ambiguity (a script that skips the register
// call, an unusable match pattern) is still rejected in extensionProblem.
export const outcomeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('response'),
    /** A short markdown answer, a few sentences at most. */
    markdown: z.string(),
  }),
  z.object({
    type: z.literal('artifact'),
    /** The artifact's name. */
    title: z.string(),
    /** One-liner: what this artifact is. */
    description: z.string().optional(),
    /** Full long-form body, markdown. */
    markdown: z.string(),
  }),
  // A persistent page modification (see extension-skill.ts for the full
  // authoring contract the agent follows).
  z.object({
    type: z.literal('extension'),
    action: z.enum(['create', 'update', 'delete']).default('create'),
    /** The stored extension's id — required for update/delete. */
    id: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    name: z.string().min(1).transform((value) => value.slice(0, 80)),
    description: z.string().min(1).transform((value) => value.slice(0, 300)),
    urlPatterns: z.preprocess(
      (value) => (typeof value === 'string' ? [value] : value),
      z.array(z.string()).min(1).max(20),
    ),
    /** An unknown or missing stage degrades to the default, not a reject. */
    stage: extensionStageSchema.catch('document_idle'),
    script: z.string().max(100_000).default(''),
  }),
  // Coming later: 'action' (a step the butler takes on the user's behalf).
]);

export type Outcome = z.infer<typeof outcomeSchema>;
export type ExtensionOutcome = Extract<Outcome, { type: 'extension' }>;

// ---------------------------------------------------------------------------
// Chrome match patterns: the URL grammar extensions target pages with.
// Validated here so a bad pattern is rejected at store time, and evaluated
// here to find the extensions active on the page a message came from.
// ---------------------------------------------------------------------------

const MATCH_PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:]+)(\/.*)$/;

/** True if `pattern` is a well-formed http(s) match pattern. */
export function isValidMatchPattern(pattern: string): boolean {
  if (pattern === '<all_urls>') return true;
  return MATCH_PATTERN.test(pattern);
}

/** True if `url` (http/https) is covered by `pattern`. */
export function matchesPattern(pattern: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (pattern === '<all_urls>') return true;

  const match = MATCH_PATTERN.exec(pattern);
  if (!match) return false;
  const [, scheme, host, path] = match;

  if (scheme !== '*' && `${scheme}:` !== parsed.protocol) return false;

  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (parsed.hostname !== base && !parsed.hostname.endsWith(`.${base}`)) {
        return false;
      }
    } else if (parsed.hostname !== host) {
      return false;
    }
  }

  // Path globbing: '*' spans any characters, everything else is literal.
  const pathRegex = new RegExp(
    `^${path.split('*').map(escapeRegExp).join('.*')}$`,
  );
  return pathRegex.test(parsed.pathname + parsed.search);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Contract check for an agent-authored extension script, mirroring what
 * the skill promises will be rejected. Returns the problem, or null.
 */
export function extensionProblem(outcome: ExtensionOutcome): string | null {
  if (outcome.action !== 'delete') {
    if (!outcome.script.includes('webButler.register(')) {
      return 'the script must call webButler.register({ apply, remove })';
    }
    const invalid = outcome.urlPatterns.find((p) => !isValidMatchPattern(p));
    if (invalid) return `"${invalid}" is not a valid match pattern`;
  }
  if (outcome.action !== 'create' && !outcome.id) {
    return `${outcome.action} needs the extension's id`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Turn context files: the user's stored work, readable on the VM.
// ---------------------------------------------------------------------------

/** What each context file already holds, per VM, so a turn only writes
    what changed: extensions are versioned, reports immutable by id. Lives
    in server memory — a restart just rewrites once. */
const syncedContext = new Map<string, Map<string, number>>();

/**
 * Mirror the user's extensions (current scripts) and past reports onto the
 * VM before a turn, so the agent can read what it is asked to build on.
 * Best-effort: a failed write costs the agent a readable file, never the
 * turn — the envelope still lists everything.
 */
export async function syncTurnContext(
  vmId: string,
  extensions: Array<{ id: string; version: number; script: string }>,
  reports: Array<{
    id: string;
    title: string;
    description: string;
    text: string;
  }>,
): Promise<void> {
  try {
    const vm = getFreestyle().vms.ref({ vmId });
    let memo = syncedContext.get(vmId);
    if (!memo) {
      // First sync since server start: the dirs may predate this feature
      // on an old VM, and fs writes don't create parents. Only remember
      // the VM once the mkdir lands, so a transient failure retries.
      await vm.exec({
        command: `mkdir -p ${CONTEXT_DIR}/extensions ${CONTEXT_DIR}/reports`,
        timeoutMs: 15_000,
      });
      memo = new Map();
      syncedContext.set(vmId, memo);
    }
    const writes: Array<Promise<unknown>> = [];
    for (const ext of extensions) {
      const key = `ext:${ext.id}`;
      if (memo.get(key) === ext.version) continue;
      writes.push(
        vm.fs
          .writeTextFile(extensionSourcePath(ext.id), ext.script)
          .then(() => memo.set(key, ext.version)),
      );
    }
    for (const report of reports) {
      const key = `report:${report.id}`;
      if (memo.has(key)) continue;
      const body =
        `# ${report.title}\n\n` +
        (report.description ? `${report.description}\n\n` : '') +
        report.text;
      writes.push(
        vm.fs
          .writeTextFile(reportSourcePath(report.id), body)
          .then(() => memo.set(key, 1)),
      );
    }
    await Promise.allSettled(writes);
  } catch (error) {
    console.warn(`[butler] context sync failed on ${vmId}:`, error);
  }
}

/** Follow-up prompts the agent may offer alongside its outcomes. Junk
    entries are dropped one by one rather than failing the field (or the
    file): losing a suggestion is nothing, losing the outcome next to it
    is the turn. */
const suggestionsSchema = z.unknown().transform((value): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, 120))
    .filter((entry) => entry.length > 0)
    .slice(0, 3);
});

/** A page section the agent flagged alongside its outcome: a CSS selector
    plus a short markdown note (what this is, why it matters). Rendered as
    marker overlays; `highlight:` links in the outcome markdown jump to
    them. */
export type PageHighlight = {
  id: string;
  selector: string;
  note?: string;
};

/** Like suggestions: junk entries drop one by one instead of failing the
    file. Missing ids are filled in (h1, h2, …) — the markdown links need
    something to point at — and duplicates are de-duped by suffix. */
const highlightsSchema = z.unknown().transform((value): PageHighlight[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const highlights: PageHighlight[] = [];
  for (const entry of value) {
    if (highlights.length >= 8) break;
    if (entry == null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const selector =
      typeof record.selector === 'string'
        ? record.selector.trim().slice(0, 400)
        : '';
    if (!selector) continue;
    let id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 60)
        : `h${highlights.length + 1}`;
    while (seen.has(id)) id = `${id}-${highlights.length + 1}`;
    seen.add(id);
    const note =
      typeof record.note === 'string'
        ? record.note.trim().slice(0, 500)
        : undefined;
    highlights.push({ id, selector, note: note || undefined });
  }
  return highlights;
});

const outcomesFileSchema = z.object({
  outcomes: z.array(outcomeSchema).min(1),
  suggestions: suggestionsSchema.optional(),
  highlights: highlightsSchema.optional(),
});

/**
 * Shape repairs that need to see the whole file, applied before schema
 * validation: a lone outcome object instead of the { outcomes: [...] }
 * wrapper, a single object where the array belongs, and a response that
 * used "text" instead of "markdown".
 */
export function normalizeOutcomesFile(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return Array.isArray(raw) ? { outcomes: raw } : raw;
  }
  const record = raw as Record<string, unknown>;
  if (!('outcomes' in record)) {
    return 'type' in record ? { outcomes: [normalizeOutcome(record)] } : raw;
  }
  const outcomes = Array.isArray(record.outcomes)
    ? record.outcomes
    : [record.outcomes];
  return { ...record, outcomes: outcomes.map(normalizeOutcome) };
}

function normalizeOutcome(outcome: unknown): unknown {
  if (outcome == null || typeof outcome !== 'object') return outcome;
  const record = outcome as Record<string, unknown>;
  if (
    (record.type === 'response' || record.type === 'artifact') &&
    typeof record.markdown !== 'string' &&
    typeof record.text === 'string'
  ) {
    return { ...record, markdown: record.text };
  }
  return outcome;
}

export const BUTLER_BRIEFING = `# Web Butler

You are Web Butler, the user's assistant living inside their browser. They talk to you from a small prompt attached to whatever page they are on. They ask questions about pages, ask you to complete tasks, and sometimes reference specific page elements.

## What every message looks like

Each user message arrives inside an envelope describing where they were:

- "Current page": the URL and title of the page the message was sent from.
- "Selected elements": present when the user explicitly picked elements on the page as context. Each comes with its CSS selector, visible text, and outer HTML. One marked "no longer on the page" has been removed since it was picked; it is still meaningful context.
- "Page HTML snapshot": the page's DOM with scripts and styles stripped, possibly truncated. Use it to answer questions about the page without asking the user to describe it.
- "Installed extensions": every page modification you have installed for this user, with the ones matching the current page marked. Each entry lists a Source path: the extension's CURRENT script, on your disk — read it before updating or merging, never rewrite from memory. When asked to change something an existing extension already touches, update or delete that extension (by id) rather than stacking a new one. Ones installed for other sites tell you what the user has asked for elsewhere.
- "Past reports": long-form documents you produced earlier, each with the path its full markdown is stored at on your disk. When the user references earlier work ("like that report", "update the comparison", "based on what you found") read the relevant file rather than guessing at what it said.
- "Ongoing tasks": other requests of yours still running right now (possibly in other conversations). Don't duplicate their work; if the user asks about one, report what you know from the listing.
- "Recent tasks": the user's request history, newest first, with how each ended and what it produced. Use it for continuity: "do that again", "like last time", or follow-ups referencing earlier work.
- "User message": the actual instruction. This is what you act on; everything above it is context.

## How to answer: the outcome file

The outcome file is the ONLY thing the user sees, and the ONLY channel that creates anything. Your reasoning, tool calls, and streamed assistant text are all invisible to them — the UI shows just the outcome, so it must stand entirely on its own. Never refer to anything outside it: no "as mentioned above", no "the options I found" unless the outcome itself lists those options, no referencing offers, prices, or findings you saw along the way without restating them. Read your outcome back as a user who saw nothing else; if it leans on missing context, rewrite it.

At the end of EVERY turn, write a JSON file at the exact path given in that turn's "Turn outcome" section (the path changes every turn; overwrite if it somehow exists). The file must be:

{ "outcomes": [ <outcome> ], "suggestions": [ "..." ] }

with exactly one outcome (the single exception is extension merges, described below), one of:

1. A short response, for quick answers, confirmations, and small findings:
   { "type": "response", "markdown": "..." }
   Keep it to a few sentences of markdown at most.

2. A long-form artifact, for substantial deliverables (reports, drafts, research writeups, comparisons). It is rendered in a dedicated panel:
   { "type": "artifact", "title": "...", "description": "...", "markdown": "..." }
   "title" names the artifact, "description" is a one-line summary, "markdown" is the full body.

Markdown in responses and artifacts renders with GitHub-flavored extras: tables, task lists, strikethrough, fenced code, links, and images. Reach for a table whenever you compare things across more than two attributes — it reads far better than nested bullets. Images render from absolute URLs only; embed one when you have a real URL from the page or your browsing (a product photo, a chart you found), and never fabricate a URL. Raw HTML is stripped, so stay in markdown.

3. A page extension, when the user asks to change a website persistently ("hide X", "add Y to this page", "always do Z here"). This installs a script that re-applies on every future visit. Before writing one, read the authoring contract at skills/page-extension/SKILL.md in your workspace — it specifies the exact script shape and the outcome fields. Do not produce an extension outcome without following it. Extensions are not limited to hiding and restyling: they can call APIs and render live data (via a background-backed \`page.fetch\` that bypasses page CORS and carries the site's cookies), so "add a button that does X" or "show me Y inline" is an extension too. When you don't already know the API a page uses, investigate it first with browser control — \`browser network\` reveals the real endpoints (see below) — then build the extension against what you found.

Prefer a response unless the user asked for something substantial enough to deserve a document, or for a page change that should persist. Never put a long document into a response.

### Merging extensions

When the user asks to combine, consolidate, or clean up their extensions (or one request naturally folds several into one), a single turn's file may carry SEVERAL extension outcomes: one "update" for the surviving extension — read every source file involved first, and write a script that covers the combined behavior with the union of their urlPatterns — plus one "delete" outcome (with its id, name, and description) for each extension absorbed into it. This is the only case where the outcomes array holds more than one entry.

### Suggested next prompts

"suggestions" is optional: up to three follow-up prompts the user might plausibly send next, shown as one-tap chips when your task finishes. Write each in the user's voice, under ~60 characters, concrete to THIS task's result ("Draft a reply to the top comment", "Do the same for the pricing page") — never generic filler like "anything else?". Omit the field when no natural next step exists.

### Page highlights

"highlights" is optional: up to eight sections of the CURRENT page to point the user at, next to "outcomes":

{ "outcomes": [...], "highlights": [ { "id": "pricing-row", "selector": "#plans tr:nth-child(3)", "note": "..." } ] }

"selector" is a CSS selector that must resolve on the page this message came from — build it from the HTML snapshot, preferring ids and stable class names over long positional chains. "note" is one or two short sentences of markdown: what this section is and why you flagged it. Each highlight renders as a quiet marker over that part of the page; nothing scrolls or flashes on its own.

To send the user to one, link it from your response or artifact markdown: [the third pricing row](highlight:pricing-row). Clicking that link scrolls the page to the section and opens its note. Always pair highlights with links — a highlight nothing points to is just noise — and use them only when the answer is about specific places in the page ("this button opens the modal", "these two rows disagree"), never for general answers. Highlights only work on the page the message came from; don't emit them for other tabs or for work that isn't about this page.

## Acting in the page (browser control)

Some tasks are done IN the page rather than written up: filling a form, composing an email, stepping through a flow. For those you can drive the user's real browser tab with the \`browser\` command — it moves a visible cursor and clicks/types like a person, and the user watches it happen. Read skills/browser-control/SKILL.md before using it. The rhythm is: \`browser snapshot\` to get a ref map of the page, then \`browser click\`/\`browser type\` on those refs, re-snapshotting after anything changes. After acting, still write a \`response\` outcome summarizing what you did and anything you left for the user to confirm. Use browser control only to ACT; to read or answer, the page HTML snapshot below is enough.

Browser control also sees the tab's network traffic: \`browser network\` lists the XHR/fetch calls a page makes, with URLs, methods, and request/response bodies. That is the investigation half of building a data-driven extension — learn the API from real traffic, then author an extension that calls it with \`page.fetch\`.

A fourth outcome type, actions, will be added later; today only response/artifact/extension exist.

Anything you print as normal assistant text is used only as a fallback when the outcome file is missing, so write the file every time — and even then, assume the user never read it.

## Claims must match the outcome file

The outcome file is not a summary of your work. It IS your work. It is the only channel that creates anything: an extension or artifact that appears in your prose but not in the file does not exist. No script is installed, no document is saved, and the user is left with a claim that has nothing behind it.

- Never say you installed, created, updated, or deleted an extension unless the outcome file you wrote THIS turn contains that exact extension outcome.
- Never say you produced an artifact unless the file you wrote this turn contains that artifact.
- If you ran out of time, hit an error, or could not finish, write a response outcome that says so plainly. An honest "I could not finish this" is always better than a confident claim the system cannot back.

The server compares your reply against the file after every turn. A claimed extension with no extension outcome behind it is surfaced to the user as a warning, not a success.

## Memory

Your workspace directory persists between conversations. Keep durable observations about the user's preferences in notes.md — read it when it exists, append sparingly.`;

/** A fresh outcome-file path for one turn. */
export function newOutcomePath(): string {
  return `${OUTCOME_DIR}/outcome-${randomUUID()}.json`;
}

/** "3m ago", "2h ago", "5d ago" — envelope-friendly relative time. */
export function agoLabel(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Cross-conversation context: what the envelope carries beyond the page. */
export type TurnExtras = {
  /** Everything installed for this user; `onPage` marks matches for the
      current URL. */
  extensions?: Array<{
    id: string;
    name: string;
    description: string;
    urlPatterns: string[];
    version: number;
    enabled: boolean;
    onPage: boolean;
  }>;
  /** Other runs currently in flight (this one excluded). */
  ongoingTasks?: Array<{ prompt: string; startedAt: number; url?: string }>;
  /** The user's open tabs, active one marked — the stage for browser
      control and useful context on its own. */
  openTabs?: Array<{ title: string; url: string; active: boolean }>;
  /** The user's settled task history, newest first. */
  recentTasks?: Array<{
    prompt: string;
    status: string;
    outcome?: string;
    /** What the task left behind, beyond its outcome line. */
    produced?: 'artifact' | 'extension';
    finishedAt?: number;
    url?: string;
  }>;
  /** Past long-form reports, newest first — each mirrored to a VM file
      (reportSourcePath) the agent can read to build on earlier work. */
  reports?: Array<{
    id: string;
    title: string;
    description: string;
    createdAt: number;
  }>;
};

/** Compact host tag for envelope listings; silent for unparseable URLs. */
function hostTag(url: string | undefined): string {
  if (!url) return '';
  try {
    return ` · on ${new URL(url).hostname}`;
  } catch {
    return '';
  }
}

/** The envelope around one user message. */
export function buildTurnMessage(
  prompt: string,
  page: PageContext | undefined,
  outcomePath: string,
  extras: TurnExtras = {},
): string {
  const parts: string[] = [];

  if (page) {
    parts.push(
      `## Current page\nURL: ${page.url}` +
        (page.title ? `\nTitle: ${page.title}` : ''),
    );

    const selection = page.selection ?? [];
    if (selection.length > 0) {
      const items = selection.map((element, index) => {
        const flags = element.missing ? ' (no longer on the page)' : '';
        const text = element.text ? `\n   Text: ${element.text}` : '';
        return (
          `${index + 1}. ${element.label}${flags}\n` +
          `   Selector: ${element.selector}${text}\n` +
          '```html\n' +
          element.html +
          '\n```'
        );
      });
      parts.push(
        `## Selected elements (${selection.length})\n` +
          'The user picked these on the page as context for their message:\n\n' +
          items.join('\n'),
      );
    }

    if (page.html) {
      parts.push(
        '## Page HTML snapshot\n' +
          'Scripts and styles stripped; may be truncated.\n' +
          '```html\n' +
          page.html +
          '\n```',
      );
    }
  }

  const extensions = extras.extensions ?? [];
  if (extensions.length > 0) {
    const item = (ext: (typeof extensions)[number]) => {
      const state = ext.enabled ? '' : ' (currently disabled)';
      return (
        `- ${ext.name}${state} · id: ${ext.id} · v${ext.version} · ` +
        `patterns: ${ext.urlPatterns.join(', ')}\n  ${ext.description}\n` +
        `  Source: ${extensionSourcePath(ext.id)}`
      );
    };
    const onPage = extensions.filter((ext) => ext.onPage);
    const elsewhere = extensions.filter((ext) => !ext.onPage);
    const sections: string[] = [];
    if (onPage.length > 0) {
      sections.push(
        'Matching this page (update or delete these by id rather than ' +
          'stacking new ones):\n' +
          onPage.map(item).join('\n'),
      );
    }
    if (elsewhere.length > 0) {
      sections.push(
        'Installed for other pages:\n' + elsewhere.map(item).join('\n'),
      );
    }
    parts.push(
      '## Installed extensions\n' +
        'Page modifications you previously installed for this user.\n\n' +
        sections.join('\n\n'),
    );
  }

  const openTabs = extras.openTabs ?? [];
  if (openTabs.length > 0) {
    const items = openTabs.map((tab) => {
      const active = tab.active ? ' (active — the browser-control stage)' : '';
      return `- ${tab.title || '(untitled)'}${active}\n  ${tab.url}`;
    });
    parts.push(
      '## Open tabs\n' +
        "The user's currently open tabs. Browser control acts on the " +
        'active one.\n' +
        items.join('\n'),
    );
  }

  const ongoing = extras.ongoingTasks ?? [];
  if (ongoing.length > 0) {
    const items = ongoing.map(
      (task) =>
        `- "${task.prompt}" · started ${agoLabel(task.startedAt)}${hostTag(task.url)}`,
    );
    parts.push(
      '## Ongoing tasks\n' +
        'Other requests still running right now — do not redo their work:\n' +
        items.join('\n'),
    );
  }

  const reports = extras.reports ?? [];
  if (reports.length > 0) {
    const items = reports.map(
      (report) =>
        `- "${report.title}" · ${agoLabel(report.createdAt)}\n` +
        `  ${report.description}\n  File: ${reportSourcePath(report.id)}`,
    );
    parts.push(
      '## Past reports\n' +
        'Documents you produced for this user earlier, newest first. Read ' +
        "the file when one is relevant to what they're asking now.\n" +
        items.join('\n'),
    );
  }

  const recent = extras.recentTasks ?? [];
  if (recent.length > 0) {
    const items = recent.map((task) => {
      const when = task.finishedAt ? `${agoLabel(task.finishedAt)} · ` : '';
      const produced =
        task.produced === 'artifact'
          ? ' (produced an artifact)'
          : task.produced === 'extension'
            ? ' (installed an extension)'
            : '';
      return (
        `- ${when}"${task.prompt}"${hostTag(task.url)} → ` +
        `${task.status}${task.outcome ? `: ${task.outcome}` : ''}${produced}`
      );
    });
    parts.push(`## Recent tasks\nNewest first.\n${items.join('\n')}`);
  }

  parts.push(`## User message\n${prompt}`);
  parts.push(
    '## Turn outcome\n' +
      `When you finish this turn, write your outcomes JSON to exactly this path: ${outcomePath}\n` +
      'Only this file creates anything. Do not tell the user an extension ' +
      'or artifact exists unless this file declares it.',
  );

  return parts.join('\n\n');
}

/** One outcome-file read. `invalid` is set when the agent wrote a file we
    could not accept — the caller can give it one corrective turn. */
export type OutcomeRead = {
  outcomes: Outcome[];
  /** Follow-up prompts the agent offered next to its outcomes. */
  suggestions?: string[];
  /** Page sections the agent flagged — rendered as markers on the page. */
  highlights?: PageHighlight[];
  /** Why the written file was rejected; unset when the file was simply
      missing (the fallback response is then business as usual). */
  invalid?: string;
  /** True when the agent wrote no file at all, so `outcomes` is just the
      streamed reply repackaged. Distinguished from `invalid` because it
      needs different pushback: the reply-vs-outcome claim check can be
      more aggressive when nothing was declared, not merely misdeclared. */
  fileMissing?: boolean;
};

/**
 * Collect the turn's outcomes from the VM (consuming the file). An agent
 * that didn't write the file degrades to its streamed reply as a short
 * response. One that wrote an INVALID file additionally reports why, so
 * the prompt route can ask it to correct the file rather than silently
 * presenting the streamed reply as if the declared work landed.
 */
export async function readOutcomes(
  vmId: string,
  outcomePath: string,
  fallbackText: string,
): Promise<OutcomeRead> {
  let invalid: string | undefined;
  let fileMissing = false;
  try {
    const vm = getFreestyle().vms.ref({ vmId });
    const result = await vm.exec({
      command: `cat ${outcomePath} && rm -f ${outcomePath}`,
      timeoutMs: 15_000,
    });
    // Non-zero status: no file. The agent answered in plain text only.
    if (result.statusCode === 0) {
      const raw = result.stdout ?? '';
      try {
        const parsed = outcomesFileSchema.safeParse(
          normalizeOutcomesFile(JSON.parse(raw)),
        );
        if (parsed.success) {
          return {
            outcomes: parsed.data.outcomes,
            suggestions: parsed.data.suggestions?.length
              ? parsed.data.suggestions
              : undefined,
            highlights: parsed.data.highlights?.length
              ? parsed.data.highlights
              : undefined,
          };
        }
        invalid = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`)
          .join('; ');
      } catch {
        invalid = 'the file is not valid JSON';
      }
      console.warn(
        `[butler] outcome file rejected on ${vmId} (${invalid}): ${raw.slice(0, 400)}`,
      );
    } else {
      fileMissing = true;
    }
  } catch (error) {
    // A failed read (VM hiccup, timeout) is NOT the agent's fault, so it
    // sets neither flag: pushing back on the agent for it would be unfair
    // and useless.
    console.warn(`[butler] outcome read failed on ${vmId}:`, error);
  }
  const text = fallbackText.trim();
  return {
    outcomes: [{ type: 'response', markdown: text || 'Done.' }],
    invalid,
    fileMissing,
  };
}

/** The corrective follow-up sent when a turn's outcome file was rejected. */
export function outcomeRetryMessage(
  problem: string,
  outcomePath: string,
): string {
  return (
    `Your outcome file from the previous turn was rejected: ${problem}.\n\n` +
    'Do NOT redo the work. Write a corrected outcomes JSON file, following ' +
    'the exact shape from your briefing (and skills/page-extension/SKILL.md ' +
    `for extensions), to exactly this path: ${outcomePath}`
  );
}

/** The corrective follow-up sent when the reply claims an extension the
    outcome file never declared. The agent gets one turn to either back
    the claim with the real outcome or retract it honestly. */
export function extensionClaimRetryMessage(
  outcomePath: string,
  fileMissing: boolean,
): string {
  const observed = fileMissing
    ? 'Your previous turn wrote no outcome file at all, yet your reply ' +
      'says an extension was installed, created, or updated.'
    : 'Your outcome file from the previous turn contains no extension ' +
      'outcome, yet your reply says an extension was installed, created, ' +
      'or updated.';
  return (
    `${observed} Only the outcome file creates extensions: nothing was ` +
    'saved.\n\n' +
    'Do NOT redo unrelated work. Do exactly one of these:\n' +
    '1. If you actually authored the extension, write the outcomes JSON ' +
    'with the real extension outcome (see skills/page-extension/SKILL.md) ' +
    `to exactly this path: ${outcomePath}\n` +
    '2. If you did not finish it, write a response outcome to that same ' +
    'path that honestly tells the user no extension was installed.'
  );
}
