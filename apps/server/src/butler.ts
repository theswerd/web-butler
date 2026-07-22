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
 *    to the streamed reply text as a plain response.
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
    action: z.enum(['create', 'update', 'delete']),
    /** The stored extension's id — required for update/delete. */
    id: z.string().optional(),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
    urlPatterns: z.array(z.string()).min(1).max(20),
    stage: extensionStageSchema.default('document_idle'),
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

The outcome file is the ONLY thing the user sees. Your reasoning, tool calls, and streamed assistant text are all invisible to them — the UI shows just the outcome, so it must stand entirely on its own. Never refer to anything outside it: no "as mentioned above", no "the options I found" unless the outcome itself lists those options, no referencing offers, prices, or findings you saw along the way without restating them. Read your outcome back as a user who saw nothing else; if it leans on missing context, rewrite it.

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

A fourth type, actions, will be added later; today only these three exist.

Anything you print as normal assistant text is used only as a fallback when the outcome file is missing, so write the file every time — and even then, assume the user never read it.

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
      `When you finish this turn, write your outcomes JSON to exactly this path: ${outcomePath}`,
  );

  return parts.join('\n\n');
}

/**
 * Collect the turn's outcomes from the VM (consuming the file). An agent
 * that didn't write the file, or wrote something invalid, degrades to its
 * streamed reply as a short response — the turn still lands.
 */
export async function readOutcomes(
  vmId: string,
  outcomePath: string,
  fallbackText: string,
): Promise<Outcome[]> {
  try {
    const vm = getFreestyle().vms.ref({ vmId });
    const result = await vm.exec({
      command: `cat ${outcomePath} && rm -f ${outcomePath}`,
      timeoutMs: 15_000,
    });
    if (result.statusCode === 0) {
      const parsed = outcomesFileSchema.safeParse(
        JSON.parse(result.stdout ?? ''),
      );
      if (parsed.success) return parsed.data.outcomes;
      console.warn(`[butler] outcome file failed validation on ${vmId}`);
    }
  } catch (error) {
    console.warn(`[butler] outcome read failed on ${vmId}:`, error);
  }
  const text = fallbackText.trim();
  return [{ type: 'response', markdown: text || 'Done.' }];
}
