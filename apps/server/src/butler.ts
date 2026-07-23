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

const outcomesFileSchema = z.object({
  outcomes: z.array(outcomeSchema).min(1),
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
- "Installed extensions": every page modification you have installed for this user, with the ones matching the current page marked. When asked to change something an existing extension already touches, update or delete that extension (by id) rather than stacking a new one. Ones installed for other sites tell you what the user has asked for elsewhere.
- "Ongoing tasks": other requests of yours still running right now (possibly in other conversations). Don't duplicate their work; if the user asks about one, report what you know from the listing.
- "Recent tasks": the user's request history, newest first, with how each ended and what it produced. Use it for continuity: "do that again", "like last time", or follow-ups referencing earlier work.
- "User message": the actual instruction. This is what you act on; everything above it is context.

## How to answer: the outcome file

The outcome file is the ONLY thing the user sees, and the ONLY channel that creates anything. Your reasoning, tool calls, and streamed assistant text are all invisible to them — the UI shows just the outcome, so it must stand entirely on its own. Never refer to anything outside it: no "as mentioned above", no "the options I found" unless the outcome itself lists those options, no referencing offers, prices, or findings you saw along the way without restating them. Read your outcome back as a user who saw nothing else; if it leans on missing context, rewrite it.

At the end of EVERY turn, write a JSON file at the exact path given in that turn's "Turn outcome" section (the path changes every turn; overwrite if it somehow exists). The file must be:

{ "outcomes": [ <outcome> ] }

with exactly one outcome, one of:

1. A short response, for quick answers, confirmations, and small findings:
   { "type": "response", "markdown": "..." }
   Keep it to a few sentences of markdown at most.

2. A long-form artifact, for substantial deliverables (reports, drafts, research writeups, comparisons). It is rendered in a dedicated panel:
   { "type": "artifact", "title": "...", "description": "...", "markdown": "..." }
   "title" names the artifact, "description" is a one-line summary, "markdown" is the full body.

3. A page extension, when the user asks to change a website persistently ("hide X", "add Y to this page", "always do Z here"). This installs a script that re-applies on every future visit. Before writing one, read the authoring contract at skills/page-extension/SKILL.md in your workspace — it specifies the exact script shape and the outcome fields. Do not produce an extension outcome without following it.

Prefer a response unless the user asked for something substantial enough to deserve a document, or for a page change that should persist. Never put a long document into a response.

## Acting in the page (browser control)

Some tasks are done IN the page rather than written up: filling a form, composing an email, stepping through a flow. For those you can drive the user's real browser tab with the \`browser\` command — it moves a visible cursor and clicks/types like a person, and the user watches it happen. Read skills/browser-control/SKILL.md before using it. The rhythm is: \`browser snapshot\` to get a ref map of the page, then \`browser click\`/\`browser type\` on those refs, re-snapshotting after anything changes. After acting, still write a \`response\` outcome summarizing what you did and anything you left for the user to confirm. Use browser control only to ACT; to read or answer, the page HTML snapshot below is enough.

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
        `patterns: ${ext.urlPatterns.join(', ')}\n  ${ext.description}`
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
        if (parsed.success) return { outcomes: parsed.data.outcomes };
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
