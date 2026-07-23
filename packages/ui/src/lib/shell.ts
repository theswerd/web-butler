import type { PageContext } from './page-elements';

// The service worker imports from ./shell only (never the React barrel), so
// the page-context types it needs ride along here.
export type { PageContext, SelectedElement } from './page-elements';

export type ShellMode = 'collapsed' | 'open';

export type ViewId =
  | 'tasks'
  | 'artifacts'
  | 'extensions'
  | 'providers'
  | 'settings';

export const TOGGLE_COMMAND = 'web-butler-toggle';

// ---------------------------------------------------------------------------
// Runs & tasks — the two visibility scopes.
//
// Everything an agent does starts as a Run, owned by the background script,
// and is mirrored into the session-wide Task list (the menu's Tasks view).
//   scope 'tab'    — a page question. The result renders as an AnswerCard in
//                    the origin tab only, and nowhere else.
//   scope 'global' — a job that leaves the tab (new tab, background research,
//                    drafting). The origin prompt is released immediately;
//                    completion toasts in every tab via the finished Task.
// ---------------------------------------------------------------------------

export type AnswerTier = 'status' | 'answer' | 'artifact' | 'extension' | 'error';

export type RunScope = 'tab' | 'global';

/**
 * working   → the origin tab's prompt is busy (shimmer, stop button).
 * delegated → work moved off-tab; the prompt frees silently. Completion
 *             arrives as a finished global task, not an in-place answer.
 * done      → finished; `result` holds what the AnswerCard should render.
 */
export type RunStatus = 'working' | 'delegated' | 'done';

/** What an AnswerCard renders — mirrors its props, minus the callbacks. */
export type RunResult = {
  tier: AnswerTier;
  /** Markdown-lite body. Extension tier: the verb ("Installed"/"Updated"). */
  text: string;
  /** Artifact handoff card title / extension tier: the extension's name. */
  title?: string;
  /** Artifact one-liner / extension tier: what the extension does. */
  description?: string;
  /** Extension tier: the installed/updated extension's id — the card's
      on/off switch and live state are wired to it. */
  extensionId?: string;
  /** Extension tier: the match patterns it covers (rendered as hosts). */
  urlPatterns?: string[];
  hints?: string[];
  choices?: string[];
  choiceMode?: 'single' | 'multi';
  choiceSubmitLabel?: string;
};

export type Run = {
  id: string;
  scope: RunScope;
  /** Tab the prompt was sent from — the only tab that renders the result. */
  tabId: number;
  /** Page the prompt was sent from — stamps report metadata. */
  url: string;
  prompt: string;
  status: RunStatus;
  startedAt: number;
  result?: RunResult;
};

/**
 * A long-form artifact rendered in the Chrome side panel (ReportView).
 * Produced by artifact-tier tab runs and by global runs that draft/research;
 * the in-page surfaces (handoff card, task row, toast) only ever link to it.
 */
export type Report = {
  id: string;
  /** The artifact's name — every artifact has one. */
  title: string;
  /** One-liner: what this artifact is. Shown in lists and under the title. */
  description: string;
  /** e.g. "example.com — 4:12 PM" — where and when it was produced. */
  meta?: string;
  /** Markdown-lite body. */
  text: string;
  createdAt: number;
};

/**
 * running → the agent is on it (tab prompt busy, or working in the
 *           background for global scope).
 * stopped → the user dismissed/stopped it before it finished.
 */
export type TaskStatus = 'running' | 'done' | 'failed' | 'stopped';

/**
 * One row of the session's activity: every run, ongoing or finished,
 * tab-scoped or global. One list per browser session, identical in every
 * tab — the background owns it and broadcasts changes. This is what the
 * menu's Tasks view lists, what badges count (unseen finished work), what
 * completion toasts are cut from, and what the prompt's task strip shows.
 */
export type Task = {
  /** Same id as the run that produced it. */
  id: string;
  scope: RunScope;
  prompt: string;
  /** Page the prompt was sent from. */
  url: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  /** Short outcome line — "Email draft ready", an error, a reply snippet. */
  outcome?: string;
  /** Set when the task produced a report — the row opens the side panel. */
  reportId?: string;
  /** Set when the task installed/updated a site extension — the row links. */
  extensionId?: string;
  /** False = finished away from the user's attention; drives the badge. */
  seen: boolean;
  /** The latest line of the live activity feed while running — what the
      butler is doing RIGHT NOW, surfaced on task chips in every tab. */
  activity?: string;
  /** Follow-up prompts the agent offered when the task settled — shown as
      one-tap "suggested next" chips in the task activity view. */
  suggestions?: string[];
};

/**
 * One line of a running task's live activity feed, cut from the agent's
 * streamed session updates. The background keeps a capped feed per task
 * (session-scoped — history from past sessions has no feed) and the side
 * panel renders it while the task runs.
 */
export type TaskUpdate = {
  at: number;
  /** thought = agent reasoning (dim), message = reply text, tool = action,
      user = a follow-up message the user added onto the running task. */
  kind: 'thought' | 'message' | 'tool' | 'user';
  text: string;
};

/**
 * What the Chrome side panel shows — latest-wins, owned by the background.
 * 'report': a published artifact (or empty). 'task': a live activity view
 * of one task, opened from its row in the Tasks list.
 */
export type PanelState =
  | { kind: 'report'; report: Report | null }
  | { kind: 'task'; task: Task; updates: TaskUpdate[] };

// ---------------------------------------------------------------------------
// Browser control — the agent driving the page through a visible ghost
// cursor. The agent (on the VM) requests actions via the `browser` CLI;
// the server relays them over the open prompt stream; the background runs
// them with chrome.debugger while the content script animates a fake
// cursor so it reads as a person doing the work, not a script.
// ---------------------------------------------------------------------------

/**
 * One action the agent asked for. `id` correlates the request with its
 * result across the VM ↔ server ↔ extension hops. Refs (`click`/`type`)
 * come from the most recent `snapshot` of the same tab.
 */
export type BrowserAction = { id: string } & (
  | { kind: 'tabs' }
  | { kind: 'snapshot' }
  | { kind: 'read' }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' }
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; submit?: boolean }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; dy: number }
  /** Dump the tab's recent network traffic (XHR/fetch by default) captured
      by the debugger — the agent's way to learn the API a page speaks
      before building an extension against it. Optional URL substring
      filter; "all" widens past XHR/fetch to every request. */
  | { kind: 'network'; filter?: string }
);

/** The outcome of one BrowserAction, sent back to unblock the CLI. */
export type BrowserActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

/** An open browser tab, for the "Open tabs" turn context and `tabs`. */
export type OpenTab = {
  id: number;
  title: string;
  url: string;
  /** The tab the user prompted from (the ghost cursor's stage). */
  active: boolean;
};

/**
 * A single instruction to the in-page ghost cursor. The background paces a
 * sequence of these (move, then click/type) around the real debugger input
 * so the pointer visibly travels to a target before it acts.
 */
export type CursorCommand =
  | { kind: 'move'; x: number; y: number; label?: string }
  | { kind: 'press'; x: number; y: number }
  | { kind: 'type'; x: number; y: number }
  | { kind: 'hide' };

/** When a site extension's script first runs on a matching page. */
export type ExtensionStage =
  | 'document_start'
  | 'document_end'
  | 'document_idle';

/**
 * A persistent page modification authored by the agent: a strictly-shaped
 * script registered as a user script for every page matching
 * `urlPatterns`, applied on every visit until toggled off or deleted.
 * Stored in the server DB; the background mirrors the list locally and
 * keeps chrome.userScripts registrations in sync.
 */
export type SiteExtension = {
  id: string;
  name: string;
  description: string;
  /** Chrome match patterns — one extension can span multiple sites. */
  urlPatterns: string[];
  script: string;
  stage: ExtensionStage;
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * An extension's latest self-check. Scripts diagnose themselves after
 * every apply (a thrown apply, or their own `check(page)` returning a
 * problem string) and report through the user-script world; the
 * background keeps the latest verdict per extension.
 */
export type ExtensionHealth = {
  status: 'ok' | 'broken';
  /** The script's own diagnosis, e.g. "no element matches nav.sidebar". */
  reason?: string;
  /** Page the last report came from. */
  url?: string;
  at: number;
};

/**
 * Mock scope classifier — a real agent will decide this itself. Until then:
 * prompts that clearly leave the page (new tabs, research, drafting,
 * watching for changes) run globally; everything else stays in the tab.
 */
const GLOBAL_PROMPT_HINTS = [
  /\bnew tab\b/i,
  /\bresearch\b/i,
  /\bdraft\b/i,
  /\bwrite (an |a )?email\b/i,
  /\bwatch (this|the)\b/i,
  /\bmonitor\b/i,
  /\bremind me\b/i,
];

export function classifyRunScope(prompt: string): RunScope {
  return GLOBAL_PROMPT_HINTS.some((hint) => hint.test(prompt))
    ? 'global'
    : 'tab';
}

/** Per-tab UI state that should survive navigations within the same tab. */
export type ShellPersist = {
  mode: ShellMode;
  draft: string;
  menuOpen: boolean;
  activeView: ViewId;
};

export const DEFAULT_SHELL_PERSIST: ShellPersist = {
  mode: 'open',
  draft: '',
  menuOpen: false,
  activeView: 'tasks',
};

export const MESSAGE = {
  TOGGLE: 'web-butler/toggle',
  SET_OPEN: 'web-butler/set-open',
  SHELL_GET: 'web-butler/shell-get',
  SHELL_PATCH: 'web-butler/shell-patch',
  // Runs: content → background.
  /** Start a run from a prompt. Responds with the created Run (scope decided). */
  RUN_START: 'web-butler/run-start',
  /** Fetch this tab's live run, if any — re-sync after a reload. */
  RUN_GET: 'web-butler/run-get',
  /** User dismissed the answer / hit stop — drop the tab's run. */
  RUN_CLEAR: 'web-butler/run-clear',
  // Runs: background → origin tab.
  /** A tab-scoped run finished; carries the result to render. */
  RUN_DONE: 'web-butler/run-done',
  // Tasks: content → background.
  TASKS_GET: 'web-butler/tasks-get',
  /** Mark seen: everything (user opened the Tasks view), or one task
      (dismissed its chip in the strip). */
  TASKS_SEEN: 'web-butler/tasks-seen',
  /** Stop a running task: aborts its agent turn and settles it. */
  TASKS_CANCEL: 'web-butler/tasks-cancel',
  /** Trash one task (running rows just vanish; the work isn't cancelled). */
  TASKS_DELETE: 'web-butler/tasks-delete',
  /** Bulk trash: 'old' clears settled history, 'all' empties the list. */
  TASKS_CLEAR: 'web-butler/tasks-clear',
  // Tasks: background → every tab.
  /** The task list changed; `finished` is set when one just completed
      off-tab — every tab toasts it. */
  TASKS_CHANGED: 'web-butler/tasks-changed',
  /** Open the side panel for the sender's tab (needs a user gesture).
      `reportId` focuses that artifact; `taskId` focuses that task's live
      activity view. */
  SIDE_PANEL_OPEN: 'web-butler/side-panel-open',
  // Side panel ↔ background.
  /** Fetch what the panel should show right now (side panel mount). */
  PANEL_GET: 'web-butler/panel-get',
  /** The panel's content changed — an open side panel re-renders live. */
  PANEL_CHANGED: 'web-butler/panel-changed',
  /** Swap an already-open panel from a task view to its report. */
  PANEL_FOCUS_REPORT: 'web-butler/panel-focus-report',
  // Side panel → background → the active tab's shell.
  /** Open the shell's menu on Extensions, highlighting one extension —
      the task activity view's "View extension" button. */
  SHELL_REVEAL_EXTENSION: 'web-butler/shell-reveal-extension',
  /** Prefill the shell's prompt with a suggested follow-up and focus it —
      the task activity view's "suggested next" chips. */
  SHELL_PREFILL: 'web-butler/shell-prefill',
  // Artifact list: content ↔ background.
  /** Fetch all artifacts of the session (menu Artifacts view). */
  REPORTS_GET: 'web-butler/reports-get',
  /** Trash one artifact (local cache + server row). */
  REPORTS_DELETE: 'web-butler/reports-delete',
  /** Trash every artifact. */
  REPORTS_CLEAR: 'web-butler/reports-clear',
  /** The artifact list changed — broadcast so open menus stay current. */
  REPORTS_CHANGED: 'web-butler/reports-changed',
  // Provider onboarding: content → background → server → sandbox VM.
  /** Start the Codex device-code login; responds with a ProviderAuth. */
  CODEX_LOGIN_START: 'web-butler/codex-login-start',
  /** Fetch Codex auth state; responds with a ProviderAuth. */
  CODEX_STATUS_GET: 'web-butler/codex-status-get',
  /** Start the Grok device-code login; responds with a ProviderAuth. */
  GROK_LOGIN_START: 'web-butler/grok-login-start',
  /** Fetch Grok auth state; responds with a ProviderAuth. */
  GROK_STATUS_GET: 'web-butler/grok-status-get',
  /** Start the Claude login; responds with a ProviderAuth (URL, no code). */
  CLAUDE_LOGIN_START: 'web-butler/claude-login-start',
  /** Fetch Claude auth state; responds with a ProviderAuth. */
  CLAUDE_STATUS_GET: 'web-butler/claude-status-get',
  /** Submit the code the user pasted back; responds with a ProviderAuth. */
  CLAUDE_CODE_SUBMIT: 'web-butler/claude-code-submit',
  // Site extensions: content ↔ background.
  /** Fetch all site extensions; responds with ExtensionsState. */
  EXTENSIONS_GET: 'web-butler/extensions-get',
  /** Toggle one on/off; responds with the updated ExtensionsState. */
  EXTENSIONS_TOGGLE: 'web-butler/extensions-toggle',
  /** Delete one; responds with the updated ExtensionsState. */
  EXTENSIONS_DELETE: 'web-butler/extensions-delete',
  /** The list changed (agent install, toggle, delete) — every tab syncs. */
  EXTENSIONS_CHANGED: 'web-butler/extensions-changed',
  /** An extension just reported itself broken on the receiving tab's page.
      Sent once per version, to that tab only — the shell offers a repair. */
  EXTENSION_BROKE: 'web-butler/extension-broke',
  /** Open chrome://extensions on this extension (user-scripts toggle). */
  USER_SCRIPTS_SETTINGS_OPEN: 'web-butler/user-scripts-settings-open',
  // Browser control: background → origin tab (the ghost cursor stage).
  /** Drive the in-page ghost cursor one step (move / press / type / hide). */
  BROWSER_CURSOR: 'web-butler/browser-cursor',
} as const;

/** The extension list plus whether Chrome will actually inject them. */
export type ExtensionsState = {
  extensions: SiteExtension[];
  /** False = the user hasn't enabled Chrome's "Allow User Scripts" yet. */
  userScriptsAvailable: boolean;
  /** Latest self-check per extension id; absent = no report yet. */
  health?: Record<string, ExtensionHealth>;
};

/**
 * Where a provider's device-auth stands, as the UI sees it.
 *
 * unknown  → not fetched yet (menu just opened)
 * starting → Connect clicked; waiting on the VM to produce a code
 * pending  → code issued; waiting for the user to finish in the browser
 */
export type ProviderAuth = {
  status:
    | 'unknown'
    | 'disconnected'
    | 'starting'
    | 'pending'
    | 'connected'
    | 'failed'
    | 'expired';
  /** One-time code the user enters after signing in (pending only). */
  userCode?: string;
  /** Sign-in page that asks for the code (pending only). */
  verificationUrl?: string;
  /** When the pending code stops working (ms epoch) — drives countdown UI. */
  expiresAt?: number;
  error?: string;
};

/**
 * RUN_START's response: the created run, or a proactive rejection when no
 * AI is connected — the shell reacts by popping the sign-in gate.
 */
export type RunStartResult = Run | { authRequired: true; auth: ProviderAuth };

export type WebButlerMessage =
  | { type: typeof MESSAGE.TOGGLE }
  | { type: typeof MESSAGE.SET_OPEN; open: boolean }
  | { type: typeof MESSAGE.SHELL_GET }
  | { type: typeof MESSAGE.SHELL_PATCH; patch: Partial<ShellPersist> }
  | {
      type: typeof MESSAGE.RUN_START;
      prompt: string;
      page: PageContext;
      /** Set when the message is a follow-up onto an existing task (its
          chip was referenced in the prompt): the turn joins that task's
          agent session instead of starting a fresh task. */
      followUpTaskId?: string;
    }
  | { type: typeof MESSAGE.RUN_GET }
  | { type: typeof MESSAGE.RUN_CLEAR }
  | { type: typeof MESSAGE.RUN_DONE; run: Run }
  | { type: typeof MESSAGE.TASKS_GET }
  | { type: typeof MESSAGE.TASKS_SEEN; id?: string }
  | { type: typeof MESSAGE.TASKS_CANCEL; id: string }
  | { type: typeof MESSAGE.TASKS_DELETE; id: string }
  | { type: typeof MESSAGE.TASKS_CLEAR; mode: 'old' | 'all' }
  | { type: typeof MESSAGE.TASKS_CHANGED; tasks: Task[]; finished?: Task }
  | { type: typeof MESSAGE.SIDE_PANEL_OPEN; reportId?: string; taskId?: string }
  | { type: typeof MESSAGE.PANEL_GET }
  | { type: typeof MESSAGE.PANEL_CHANGED; state: PanelState }
  | { type: typeof MESSAGE.PANEL_FOCUS_REPORT; reportId: string }
  | { type: typeof MESSAGE.SHELL_REVEAL_EXTENSION; extensionId: string }
  | { type: typeof MESSAGE.SHELL_PREFILL; text: string }
  | { type: typeof MESSAGE.REPORTS_GET }
  | { type: typeof MESSAGE.REPORTS_DELETE; id: string }
  | { type: typeof MESSAGE.REPORTS_CLEAR }
  | { type: typeof MESSAGE.REPORTS_CHANGED; reports: Report[] }
  | { type: typeof MESSAGE.CODEX_LOGIN_START }
  | { type: typeof MESSAGE.CODEX_STATUS_GET }
  | { type: typeof MESSAGE.GROK_LOGIN_START }
  | { type: typeof MESSAGE.GROK_STATUS_GET }
  | { type: typeof MESSAGE.CLAUDE_LOGIN_START }
  | { type: typeof MESSAGE.CLAUDE_STATUS_GET }
  | { type: typeof MESSAGE.CLAUDE_CODE_SUBMIT; code: string }
  | { type: typeof MESSAGE.EXTENSIONS_GET }
  | { type: typeof MESSAGE.EXTENSIONS_TOGGLE; id: string; enabled: boolean }
  | { type: typeof MESSAGE.EXTENSIONS_DELETE; id: string }
  | { type: typeof MESSAGE.EXTENSIONS_CHANGED; state: ExtensionsState }
  | {
      type: typeof MESSAGE.EXTENSION_BROKE;
      extension: SiteExtension;
      reason: string;
    }
  | { type: typeof MESSAGE.USER_SCRIPTS_SETTINGS_OPEN }
  | { type: typeof MESSAGE.BROWSER_CURSOR; cursor: CursorCommand };
