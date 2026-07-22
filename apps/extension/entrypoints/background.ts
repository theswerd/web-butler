import { storage } from 'wxt/utils/storage';
import { browser } from 'wxt/browser';
import {
  classifyRunScope,
  DEFAULT_SHELL_PERSIST,
  MESSAGE,
  TOGGLE_COMMAND,
  type ExtensionHealth,
  type ExtensionsState,
  type PageContext,
  type PanelState,
  type ProviderAuth,
  type Report,
  type Run,
  type RunResult,
  type RunStartResult,
  type ShellPersist,
  type SiteExtension,
  type Task,
  type TaskUpdate,
  type WebButlerMessage,
} from '@web-butler/ui/shell';
// Type-only: the settings VALUES module pulls React along, which has no
// place in a service worker bundle.
import type { Settings } from '@web-butler/ui';
import { findAnswerFixture } from '@web-butler/ui/fixtures';
import {
  clearTasksRemote,
  deleteExtension,
  deleteTaskRemote,
  ensureInitialized,
  fetchExtensions,
  fetchReports,
  fetchTasks,
  getProviderAuthStatus,
  patchExtension,
  runAgentPrompt,
  startProviderLogin,
  submitClaudeCode,
  syncReport,
  syncTask,
  syncTasksSeen,
  type AgentOutcome,
  type DeviceAuthProvider,
} from '../lib/server';
import {
  applyToOpenTabs,
  removeFromOpenTabs,
  syncRegistrations,
  userScriptsAvailable,
} from '../lib/user-scripts';

/** Per-tab shell UI state for the current browser session. */
const shellByTab = storage.defineItem<Record<string, ShellPersist>>(
  'session:shellByTab',
  { fallback: {} },
);

/**
 * The live run per tab. Tab-scoped runs park their result here so a reload
 * of the origin tab can re-fetch it; a tab only ever has one run at a time
 * (a new prompt replaces the old run).
 */
const runByTab = storage.defineItem<Record<string, Run>>('session:runByTab', {
  fallback: {},
});

/**
 * The session's activity, newest first: every run, ongoing or finished.
 * One list for the whole session — every tab renders the same list and
 * the same badge count (unseen finished tasks).
 */
const tasksItem = storage.defineItem<Task[]>('session:tasks', {
  fallback: [],
});

/**
 * Every artifact of the session, newest first. The menu's Artifacts view
 * lists them all; the side panel shows the "active" one (last published or
 * last explicitly opened).
 */
const reportsItem = storage.defineItem<Report[]>('session:reports', {
  fallback: [],
});
const activeReportId = storage.defineItem<string | null>(
  'session:activeReportId',
  { fallback: null },
);

/**
 * What the side panel shows — latest-wins, like the active report before
 * it: publishing an artifact focuses it, clicking a running task focuses
 * that task's live activity view.
 */
const panelFocusItem = storage.defineItem<
  { kind: 'report' } | { kind: 'task'; taskId: string }
>('session:panelFocus', { fallback: { kind: 'report' } });

/**
 * Live activity per task, cut from the agent's streamed session updates.
 * Session-scoped and capped — this is a progress feed, not a transcript;
 * tasks hydrated from DB history simply have none.
 */
const taskUpdatesItem = storage.defineItem<Record<string, TaskUpdate[]>>(
  'session:taskUpdates',
  { fallback: {} },
);

/**
 * Site extensions, mirrored from the server DB (which is where agent
 * `extension` outcomes land). `local:` not `session:` — these are meant to
 * apply on every page load, including the browser's first after a restart,
 * before any server round-trip. chrome.userScripts registrations are
 * re-synced from this cache on every change and every SW start.
 */
const extensionsItem = storage.defineItem<SiteExtension[]>(
  'local:extensions',
  { fallback: [] },
);

function tabKey(tabId: number) {
  return String(tabId);
}

/**
 * Read-only view of the shell's settings (written by useSettings in the
 * content script) — the background needs the active provider for runs.
 * Partial: this side never writes, and only reads keys it understands.
 */
const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', {
  fallback: {},
});

/** Mock latency for canned runs — matches the prompt's working shimmer. */
const MOCK_RUN_MS = 10_000;

/**
 * Test-only escape hatch: Playwright scripts flip this to exercise the run
 * pipeline without a real ChatGPT sign-in. Never set by product code.
 */
const devBypassAuth = storage.defineItem<boolean>('local:devBypassAuth', {
  fallback: false,
});

/**
 * Provider auth, cached per provider so run gating doesn't exec on the VM
 * for every message or page load. Connected is sticky (the CLIs refresh
 * their own tokens); anything else re-checks quickly so a finished sign-in
 * is noticed.
 */
const authCache: Partial<
  Record<DeviceAuthProvider, { auth: ProviderAuth; at: number }>
> = {};

function cacheAuth(provider: DeviceAuthProvider, auth: ProviderAuth) {
  authCache[provider] = { auth, at: Date.now() };
}

async function cachedProviderStatus(
  provider: DeviceAuthProvider,
): Promise<ProviderAuth> {
  const cached = authCache[provider];
  const ttl = cached?.auth.status === 'connected' ? 10 * 60_000 : 15_000;
  if (cached && Date.now() - cached.at < ttl) return cached.auth;
  const auth = await getProviderAuthStatus(provider);
  // Don't poison the cache while the server/VM is unreachable.
  if (auth.status !== 'unknown') cacheAuth(provider, auth);
  return auth;
}

/** Send to every tab that has the content script; ignore the ones that don't. */
async function broadcast(message: WebButlerMessage) {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      tab.id == null
        ? undefined
        : browser.tabs.sendMessage(tab.id, message).catch(() => {}),
    ),
  );
}

function taskFor(run: Run): Task {
  return {
    id: run.id,
    scope: run.scope,
    prompt: run.prompt,
    url: run.url,
    status: 'running',
    startedAt: run.startedAt,
    seen: true, // running work isn't "unread" — finishing off-tab is
  };
}

/**
 * A new run enters the activity list at the top, as `running` — before
 * anything slow (auth checks, the agent itself) happens, so the Tasks
 * view updates the moment the user hits send. Local-only: the run gets
 * synced to the DB once it's confirmed to actually execute.
 */
async function trackTask(run: Run) {
  const tasks = [taskFor(run), ...(await tasksItem.getValue())];
  await tasksItem.setValue(tasks);
  await broadcast({ type: MESSAGE.TASKS_CHANGED, tasks });
}

/** Roll back an optimistic task whose run was rejected (auth gate). */
async function untrackTask(id: string) {
  const tasks = (await tasksItem.getValue()).filter((task) => task.id !== id);
  await tasksItem.setValue(tasks);
  await broadcast({ type: MESSAGE.TASKS_CHANGED, tasks });
}

/**
 * User-initiated trashing (one row or a bulk clear): keep only what the
 * predicate passes, drop the orphaned activity feeds, tell every tab, and
 * refresh a side panel that was watching a now-gone task (panelState
 * falls back to reports by itself). Trashing a running row removes the
 * bookkeeping, not the work — the turn finishes on the VM; its settle
 * just no-ops against the missing row.
 */
async function removeTasks(keep: (task: Task) => boolean) {
  const tasks = (await tasksItem.getValue()).filter(keep);
  const ids = new Set(tasks.map((task) => task.id));
  await tasksItem.setValue(tasks);
  const feeds = await taskUpdatesItem.getValue();
  await taskUpdatesItem.setValue(
    Object.fromEntries(Object.entries(feeds).filter(([id]) => ids.has(id))),
  );
  await broadcast({ type: MESSAGE.TASKS_CHANGED, tasks });
  const focus = await panelFocusItem.getValue();
  if (focus.kind === 'task' && !ids.has(focus.taskId)) void notifyPanel();
}

/**
 * Settle a task. `announce` additionally hands the task to every tab as
 * `finished` — the cross-tab toast — and leaves it unseen so badges show
 * it. Tab-scoped completions skip that: their answer renders in-page,
 * right where the user is looking.
 */
async function settleTask(
  id: string,
  patch: Partial<Task>,
  { announce = false } = {},
) {
  const tasks = await tasksItem.getValue();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  const settled: Task = {
    ...tasks[index],
    finishedAt: Date.now(),
    seen: !announce,
    ...patch,
  };
  const next = [...tasks];
  next[index] = settled;
  await tasksItem.setValue(next);
  // Durable history — never blocks the UI. The activity feed rides along
  // so old tasks can replay in the side panel next session.
  void taskUpdatesItem
    .getValue()
    .then((all) => syncTask(settled, all[settled.id]));
  await broadcast({
    type: MESSAGE.TASKS_CHANGED,
    tasks: next,
    finished: announce ? settled : undefined,
  });
  // A side panel watching this task live sees the status flip in place.
  const focus = await panelFocusItem.getValue();
  if (focus.kind === 'task' && focus.taskId === id) void notifyPanel();
}

/**
 * Session cache ← DB, on service worker start. The server list is history
 * from past sessions (and SW lifetimes); anything still in this session's
 * cache is fresher and wins. Server rows stuck `running` belong to a dead
 * service worker — nothing is executing them — so they settle as stopped.
 */
async function hydrateTasks() {
  const remote = await fetchTasks();
  if (!remote) return; // offline — session cache stands alone
  const local = await tasksItem.getValue();
  const localIds = new Set(local.map((task) => task.id));
  const revived = remote
    .filter((task) => !localIds.has(task.id))
    .map(({ updates: _updates, ...task }) => {
      if (task.status !== 'running') return task;
      const stopped: Task = {
        ...task,
        status: 'stopped',
        outcome: task.outcome ?? 'Interrupted: the browser suspended the butler mid-task',
        seen: true,
      };
      void syncTask(stopped);
      return stopped;
    });
  const tasks = [...local, ...revived]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 100);
  await tasksItem.setValue(tasks);
  // Stored activity feeds ride along with the rows — seed the session
  // cache for tasks it doesn't already have, so any old row can replay
  // in the side panel. Live feeds (this session's) always win.
  const feeds = await taskUpdatesItem.getValue();
  const seeded = { ...feeds };
  let changed = false;
  for (const row of remote) {
    if (!row.updates?.length || seeded[row.id]) continue;
    seeded[row.id] = row.updates;
    changed = true;
  }
  if (changed) await taskUpdatesItem.setValue(seeded);
  await broadcast({ type: MESSAGE.TASKS_CHANGED, tasks });
}

// ---------------------------------------------------------------------------
// Site extensions: cache ← DB, registrations ← cache.
// ---------------------------------------------------------------------------

/**
 * Mirror the cache into Chrome's registrations — and when the sync reports
 * Chrome had none of ours (the user-scripts switch was just enabled; it
 * clears every registration when it goes off), inject into the already-open
 * matching tabs too. Registration alone only covers future page loads, so
 * without this the user has to reload every tab after flipping the switch.
 */
async function syncAndInject(extensions: SiteExtension[]): Promise<void> {
  const freshlyEnabled = await syncRegistrations(extensions);
  if (!freshlyEnabled) return;
  for (const ext of extensions.filter((entry) => entry.enabled)) {
    await applyToOpenTabs(ext);
  }
}

/** Last availability seen — flipping the Chrome toggle on mid-session
    (the onboarding permissions step) must register the cached scripts. */
let lastUserScriptsAvailable: boolean | null = null;

/**
 * Latest self-check per extension id, as reported by the scripts' own
 * diagnosis (see the prelude's `run`/`report` in user-scripts.ts).
 * `version` pins a verdict to the script that produced it — a repair bumps
 * the version, which retires the old verdict. `notifiedVersion` throttles
 * the proactive "can I fix myself?" ask to once per broken version.
 */
type HealthEntry = ExtensionHealth & {
  version: number;
  notifiedVersion?: number;
};
const extensionHealthItem = storage.defineItem<Record<string, HealthEntry>>(
  'local:extensionHealth',
  { fallback: {} },
);

/** Health, stripped of stale verdicts (deleted/re-versioned extensions). */
async function currentHealth(
  extensions: SiteExtension[],
): Promise<Record<string, ExtensionHealth>> {
  const all = await extensionHealthItem.getValue();
  const health: Record<string, ExtensionHealth> = {};
  for (const ext of extensions) {
    const entry = all[ext.id];
    if (!entry || entry.version !== ext.version) continue;
    health[ext.id] = { status: entry.status, reason: entry.reason, url: entry.url, at: entry.at };
  }
  return health;
}

async function extensionsState(): Promise<ExtensionsState> {
  const extensions = await extensionsItem.getValue();
  const available = userScriptsAvailable();
  if (available && lastUserScriptsAvailable !== true) {
    // First sighting of the switch being on in this service-worker life:
    // either it was just flipped, or the flip restarted the worker. Either
    // way syncAndInject no-ops unless registrations are actually missing.
    void syncAndInject(extensions);
  }
  lastUserScriptsAvailable = available;
  return {
    extensions,
    userScriptsAvailable: available,
    health: await currentHealth(extensions),
  };
}

/** Update the cache, re-sync Chrome's registrations, tell every tab. */
async function setExtensions(extensions: SiteExtension[]) {
  await extensionsItem.setValue(extensions);
  await syncAndInject(extensions);
  await broadcast({
    type: MESSAGE.EXTENSIONS_CHANGED,
    state: {
      extensions,
      userScriptsAvailable: userScriptsAvailable(),
      health: await currentHealth(extensions),
    },
  });
}

/**
 * A script's self-diagnosis arrived from the user-script world. Record it,
 * refresh every tab's view, and on the first "broken" for a version, ask
 * the reporting tab's shell to offer a repair.
 */
async function handleHealthReport(
  report: {
    id: string;
    version: number;
    status: 'ok' | 'broken';
    reason?: string;
    url?: string;
  },
  tabId: number | undefined,
): Promise<void> {
  const extensions = await extensionsItem.getValue();
  const ext = extensions.find((entry) => entry.id === report.id);
  // Ignore ghosts: deleted extensions and reports from replaced versions.
  if (!ext || ext.version !== report.version) return;

  const all = await extensionHealthItem.getValue();
  const previous = all[report.id];
  const entry: HealthEntry = {
    status: report.status,
    reason: report.status === 'broken' ? report.reason : undefined,
    url: report.url,
    at: Date.now(),
    version: report.version,
    notifiedVersion: previous?.notifiedVersion,
  };

  const shouldAsk =
    report.status === 'broken' &&
    tabId != null &&
    previous?.notifiedVersion !== report.version;
  if (shouldAsk) entry.notifiedVersion = report.version;

  // Skip the broadcast when nothing visible changed — ok → ok is the
  // steady state on every page load.
  const changed =
    previous?.status !== entry.status || previous?.reason !== entry.reason;
  await extensionHealthItem.setValue({ ...all, [report.id]: entry });
  if (changed) {
    await broadcast({
      type: MESSAGE.EXTENSIONS_CHANGED,
      state: {
        extensions,
        userScriptsAvailable: userScriptsAvailable(),
        health: await currentHealth(extensions),
      },
    });
  }
  if (shouldAsk) {
    void browser.tabs
      .sendMessage(tabId, {
        type: MESSAGE.EXTENSION_BROKE,
        extension: ext,
        reason: report.reason ?? 'its self-check failed',
      } satisfies WebButlerMessage)
      .catch(() => {}); // tab without our content script — the view still shows it
  }
}

/** Cache ← DB, on service worker start and after agent extension outcomes. */
async function hydrateExtensions(): Promise<SiteExtension[]> {
  const remote = await fetchExtensions();
  if (!remote) return extensionsItem.getValue(); // offline — cache stands
  await setExtensions(remote);
  return remote;
}

/**
 * An agent turn produced an extension outcome (already stored server-side).
 * Refetch the authoritative list, then make the change real in already-open
 * tabs: apply the new/updated script, or revert a deleted one. Returns the
 * task/answer line.
 */
async function handleExtensionOutcome(
  outcome: Extract<AgentOutcome, { type: 'extension' }>,
): Promise<string> {
  // For delete, the patterns needed to find live tabs are only in the old
  // cached copy — grab it before the refetch drops it.
  const previous = (await extensionsItem.getValue()).find(
    (ext) => ext.id === outcome.id,
  );
  const extensions = await hydrateExtensions();
  const stored = extensions.find((ext) => ext.id === outcome.id);

  if (outcome.action === 'delete') {
    if (previous) await removeFromOpenTabs(previous);
    return `Removed "${outcome.name}"`;
  }
  if (stored?.enabled) await applyToOpenTabs(stored);
  const verb = outcome.action === 'create' ? 'Installed' : 'Updated';
  // "Installed" while Chrome's user-scripts switch is off would be a lie —
  // the script can't inject. Say so everywhere this line lands (answer
  // card, task row, toast); the Extensions view has the enable button.
  if (!userScriptsAvailable()) {
    return `${verb} "${outcome.name}", but Chrome is blocking it. Enable "Allow User Scripts" under Extensions in the menu`;
  }
  return `${verb} "${outcome.name}"`;
}

/** First line of a reply, sized for a one-line list row / toast. */
function outcomeSnippet(text: string): string {
  const line = text
    .trim()
    .split('\n')[0]
    .replace(/^#+\s*/, '') // heading marker
    .replace(/(\*\*|__|[*_`])/g, ''); // inline emphasis/code — plain rows
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

/** "example.com · 4:12 PM" — stamps where and when a report came from. */
function reportMeta(url: string): string {
  let host = 'this page';
  try {
    host = new URL(url).hostname || host;
  } catch {
    // Keep the fallback for non-URL locations (about:blank etc.).
  }
  const time = new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${host} · ${time}`;
}

/**
 * Add to the artifact list and make it the panel's active report. An open
 * side panel re-renders immediately; open menus refresh their Artifacts view.
 */
async function publishReport(report: Report) {
  const reports = [report, ...(await reportsItem.getValue())];
  await reportsItem.setValue(reports);
  await activeReportId.setValue(report.id);
  // Durable copy — never blocks the UI (same contract as tasks).
  void syncReport(report);
  // A fresh artifact takes the panel over, superseding any task focus.
  await panelFocusItem.setValue({ kind: 'report' });
  await notifyPanel();
  await broadcast({ type: MESSAGE.REPORTS_CHANGED, reports });
}

/**
 * Session cache ← DB, on service worker start — reports from past sessions
 * reappear in the Artifacts view, and old tasks' "Open report" links work
 * again. Anything already in this session's cache is fresher and wins.
 */
async function hydrateReports() {
  const remote = await fetchReports();
  if (!remote || remote.length === 0) return; // offline — cache stands alone
  const local = await reportsItem.getValue();
  const localIds = new Set(local.map((report) => report.id));
  const reports = [
    ...local,
    ...remote.filter((report) => !localIds.has(report.id)),
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  await reportsItem.setValue(reports);
  await broadcast({ type: MESSAGE.REPORTS_CHANGED, reports });
}

/** The report the side panel should render right now. */
async function activeReport(): Promise<Report | null> {
  const [reports, activeId] = await Promise.all([
    reportsItem.getValue(),
    activeReportId.getValue(),
  ]);
  return reports.find((report) => report.id === activeId) ?? reports[0] ?? null;
}

/** Resolve the panel's focus into what it should render. A focused task
    that has vanished (session storage cleared) falls back to reports. */
async function panelState(): Promise<PanelState> {
  const focus = await panelFocusItem.getValue();
  if (focus.kind === 'task') {
    const task = (await tasksItem.getValue()).find(
      (entry) => entry.id === focus.taskId,
    );
    if (task) {
      const updates = (await taskUpdatesItem.getValue())[task.id] ?? [];
      return { kind: 'task', task, updates };
    }
    await panelFocusItem.setValue({ kind: 'report' });
  }
  return { kind: 'report', report: await activeReport() };
}

/** Push the current panel content to an open side panel (no-op when
    closed — it fetches on mount). runtime.sendMessage reaches extension
    pages like the panel, not tabs. */
async function notifyPanel() {
  await browser.runtime
    .sendMessage({ type: MESSAGE.PANEL_CHANGED, state: await panelState() })
    .catch(() => {});
}

/** Feed cap per task — a progress window, not a transcript. */
const TASK_UPDATES_MAX = 200;

/**
 * One streamed ACP session update → one feed line (or none: plans and
 * tool-status churn are noise at this altitude). Message and thought
 * chunks arrive as fragments, so consecutive same-kind lines merge.
 */
function toTaskUpdate(update: Record<string, unknown>): TaskUpdate | null {
  const kind = update.sessionUpdate;
  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    const content = update.content as { text?: unknown } | undefined;
    const text = typeof content?.text === 'string' ? content.text : '';
    if (!text) return null;
    return {
      at: Date.now(),
      kind: kind === 'agent_message_chunk' ? 'message' : 'thought',
      text,
    };
  }
  if (kind === 'tool_call') {
    const title =
      typeof update.title === 'string' && update.title.trim()
        ? update.title
        : typeof update.kind === 'string'
          ? update.kind
          : 'Working';
    return { at: Date.now(), kind: 'tool', text: title };
  }
  return null;
}

async function appendTaskUpdate(
  taskId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const update = toTaskUpdate(raw);
  if (!update) return;
  const all = await taskUpdatesItem.getValue();
  const feed = [...(all[taskId] ?? [])];
  const last = feed[feed.length - 1];
  if (last && last.kind === update.kind && update.kind !== 'tool') {
    // Streamed fragments of the same prose block grow the last line.
    feed[feed.length - 1] = { ...last, text: last.text + update.text };
  } else if (last && last.kind === 'tool' && last.text === update.text) {
    // Repeated identical tool titles add nothing.
    return;
  } else {
    feed.push(update);
  }
  await taskUpdatesItem.setValue({
    ...all,
    [taskId]: feed.slice(-TASK_UPDATES_MAX),
  });
  const focus = await panelFocusItem.getValue();
  if (focus.kind === 'task' && focus.taskId === taskId) void notifyPanel();
}

async function saveRun(run: Run) {
  const all = await runByTab.getValue();
  await runByTab.setValue({ ...all, [tabKey(run.tabId)]: run });
}

async function dropRun(tabId: number) {
  const all = await runByTab.getValue();
  const key = tabKey(tabId);
  if (!(key in all)) return;
  const { [key]: _removed, ...rest } = all;
  await runByTab.setValue(rest);
}

/**
 * Land a run as a failed turn: an error-tier result in the origin tab
 * (which frees the prompt) — unless a newer run replaced it meanwhile.
 * Used by the crash guard and the startup orphan sweep, so a run can
 * never wedge a tab in "Working…" forever.
 */
async function failRun(run: Run, text: string) {
  const all = await runByTab.getValue();
  if (all[tabKey(run.tabId)]?.id !== run.id) return; // superseded — theirs now
  const failed: Run = { ...run, status: 'done', result: { tier: 'error', text } };
  await runByTab.setValue({ ...all, [tabKey(run.tabId)]: failed });
  await browser.tabs
    .sendMessage(run.tabId, { type: MESSAGE.RUN_DONE, run: failed })
    .catch(() => {}); // origin tab gone — the stored run just expires with it
}

/**
 * Last-resort crash guard around a run's executor. The executors settle
 * their task on every path they know about; this catches the paths nobody
 * knows about (a throw in outcome handling, storage, sync) — without it,
 * `void execute…Run()` swallows the rejection and the task says "running"
 * forever. Rethrows nothing: the run is over either way.
 */
function guardRun(run: Run, work: Promise<void>) {
  void work.catch(async (error: unknown) => {
    console.error('[web-butler] run crashed:', error);
    const text =
      'Something went wrong while finishing this task. It has been stopped.';
    await settleTask(
      run.id,
      { status: 'failed', outcome: text },
      { announce: run.scope === 'global' },
    );
    await failRun(run, text);
  });
}

/**
 * Startup sweep: a fresh service worker means every in-flight executor
 * died with the previous one — session storage remembers their tasks and
 * runs as "running"/"working", but nothing is driving them anymore. Left
 * alone they'd say "working" forever (session storage outlives worker
 * restarts, and MV3 recycles workers aggressively). Settle them.
 */
async function settleOrphanedRuns() {
  const note = 'Interrupted: the browser suspended the butler mid-task';
  const orphans = (await tasksItem.getValue()).filter(
    (task) => task.status === 'running',
  );
  for (const orphan of orphans) {
    await settleTask(orphan.id, { status: 'stopped', outcome: note });
  }
  for (const run of Object.values(await runByTab.getValue())) {
    if (run.status === 'working') await failRun(run, note);
  }
}

/**
 * Mock completion for a tab-scoped run: after the canned delay, look up the
 * fixture answer and hand the result to the origin tab. Stale checks make a
 * newer prompt from the same tab win.
 */
function scheduleTabRun(run: Run) {
  setTimeout(async () => {
    const current = (await runByTab.getValue())[tabKey(run.tabId)];
    if (current?.id !== run.id) return; // replaced or cleared meanwhile

    const fixture = findAnswerFixture(run.prompt);
    const result: RunResult = fixture
      ? {
          tier: fixture.tier,
          text: fixture.text,
          title: fixture.title,
          description: fixture.description,
          hints: fixture.hints,
          choices: fixture.choices,
          choiceMode: fixture.choiceMode,
          choiceSubmitLabel: fixture.choiceSubmitLabel,
        }
      : {
          tier: 'status',
          text: 'Done. (Mock run: no matching fixture for that prompt.)',
        };

    // Artifact answers live in the side panel — the in-page card is only a
    // handoff, so the actual report has to be published for it to open onto.
    let reportId: string | undefined;
    if (result.tier === 'artifact') {
      reportId = crypto.randomUUID();
      await publishReport({
        id: reportId,
        title: result.title ?? 'Report',
        description: result.description ?? `From: "${run.prompt}"`,
        meta: reportMeta(run.url),
        text: result.text,
        createdAt: Date.now(),
      });
    }

    const done: Run = { ...run, status: 'done', result };
    await saveRun(done);
    await settleTask(run.id, {
      status: 'done',
      outcome: result.title ?? outcomeSnippet(result.text),
      reportId,
    });
    await browser.tabs
      .sendMessage(run.tabId, { type: MESSAGE.RUN_DONE, run: done })
      .catch(() => {}); // origin tab gone — the stored run just expires with it
  }, MOCK_RUN_MS);
}

/**
 * An artifact outcome becomes a Report in the side panel; every in-page
 * surface (handoff card, task row, toast) only links to it.
 */
async function publishArtifact(
  run: Run,
  artifact: Extract<AgentOutcome, { type: 'artifact' }>,
): Promise<string> {
  const id = crypto.randomUUID();
  await publishReport({
    id,
    title: artifact.title,
    description: artifact.description ?? `From: "${run.prompt}"`,
    meta: reportMeta(run.url),
    text: artifact.markdown,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Real completion for a tab-scoped run: one agent turn on the sandbox VM.
 * The agent declares its outcome — a short response renders as the in-page
 * answer; an artifact is published to the side panel with a handoff card
 * in the tab. Stale checks mirror the mock's: a newer prompt wins.
 */
async function executeTabRun(run: Run, provider: DeviceAuthProvider, page: PageContext) {
  const turn = await runAgentPrompt(provider, run.prompt, page, run.id, (update) =>
    void appendTaskUpdate(run.id, update),
  );

  const current = (await runByTab.getValue())[tabKey(run.tabId)];
  if (current?.id !== run.id) return; // replaced or cleared meanwhile

  let result: RunResult;
  let reportId: string | undefined;
  let extensionId: string | undefined;
  let taskLine: string | undefined;
  if ('error' in turn) {
    // Its own tier: a failure must not wear the status pill's checkmark,
    // and it carries recovery actions (retry, switch provider).
    result = { tier: 'error', text: turn.error };
  } else {
    const outcome = turn.outcomes[0];
    if (outcome.type === 'artifact') {
      reportId = await publishArtifact(run, outcome);
      result = {
        tier: 'artifact',
        title: outcome.title,
        description: outcome.description ?? 'The full write-up is ready.',
        text: outcome.markdown,
      };
    } else if (outcome.type === 'extension') {
      taskLine = await handleExtensionOutcome(outcome);
      if (outcome.action === 'delete') {
        result = { tier: 'status', text: taskLine };
      } else {
        extensionId = outcome.id;
        // Declarative, not a claim of success: the card presents what now
        // exists (name/description/sites) and reads the LIVE scripting
        // flag itself — whether Chrome will run it isn't knowable here.
        result = {
          tier: 'extension',
          text: outcome.action === 'create' ? 'Installed' : 'Updated',
          title: outcome.name,
          description: outcome.description,
          extensionId: outcome.id,
          urlPatterns: outcome.urlPatterns,
        };
      }
    } else {
      const text = outcome.markdown.trim();
      result = text
        ? { tier: 'answer', text }
        : { tier: 'status', text: 'Done.' };
    }
  }

  const done: Run = { ...run, status: 'done', result };
  await saveRun(done);
  await settleTask(run.id, {
    status: 'error' in turn ? 'failed' : 'done',
    outcome:
      'error' in turn
        ? turn.error
        : (taskLine ?? result.title ?? outcomeSnippet(result.text)),
    reportId,
    extensionId,
  });
  await browser.tabs
    .sendMessage(run.tabId, { type: MESSAGE.RUN_DONE, run: done })
    .catch(() => {}); // origin tab gone — the stored run just expires with it
}

/**
 * Real completion for a global run: same agent turn, but the outcome lands
 * in the task list and toasts in every tab. An artifact outcome is
 * published as a report the task links to; the origin tab's delegated ack
 * is superseded.
 */
async function executeGlobalRun(
  run: Run,
  provider: DeviceAuthProvider,
  page: PageContext,
) {
  const turn = await runAgentPrompt(provider, run.prompt, page, run.id, (update) =>
    void appendTaskUpdate(run.id, update),
  );

  if ('error' in turn) {
    await settleTask(
      run.id,
      { status: 'failed', outcome: turn.error },
      { announce: true },
    );
  } else {
    const outcome = turn.outcomes[0];
    const reportId =
      outcome.type === 'artifact'
        ? await publishArtifact(run, outcome)
        : undefined;
    const extensionLine =
      outcome.type === 'extension'
        ? await handleExtensionOutcome(outcome)
        : undefined;
    await settleTask(
      run.id,
      {
        status: 'done',
        outcome:
          outcome.type === 'artifact'
            ? outcome.title
            : outcome.type === 'extension'
              ? extensionLine
              : outcomeSnippet(outcome.markdown) || 'Background task finished',
        reportId,
        extensionId:
          outcome.type === 'extension' && outcome.action !== 'delete'
            ? outcome.id
            : undefined,
      },
      { announce: true },
    );
  }

  const current = (await runByTab.getValue())[tabKey(run.tabId)];
  if (current?.id === run.id) await dropRun(run.tabId);
}

/**
 * Mock artifact for a finished global run. Drafting and research jobs
 * produce a report the finished task links to; watch/monitor jobs don't.
 */
function reportForGlobal(run: Run): Report | null {
  const prompt = run.prompt.toLowerCase();

  if (/email|draft/.test(prompt)) {
    return {
      id: crypto.randomUUID(),
      title: 'Draft: ready to send',
      description: 'Email draft from the background research, ready to send.',
      meta: reportMeta(run.url),
      createdAt: Date.now(),
      text: `Subject: **Following up with what I found**

Hi,

I pulled together the research you asked for and drafted this so you can send it as-is or edit first. The short version: the numbers support moving ahead, and I'd flag the pricing change up front rather than burying it.

- Their public pricing moved to usage-based in March
- Two of the three case studies on their site are from our segment
- The integration we'd need is listed as GA, not beta

Happy to share the full notes if useful.

Thanks,
Ben

---

Drafted from: "${run.prompt}"`,
    };
  }

  if (/research/.test(prompt)) {
    return {
      id: crypto.randomUUID(),
      title: 'Research notes',
      description: 'Positioning, pricing, and momentum findings, with sources.',
      meta: reportMeta(run.url),
      createdAt: Date.now(),
      text: `Ran the background research and kept the load-bearing findings:

- **Positioning**: they lead with compliance, not speed; every landing page above the fold mentions SOC 2
- **Pricing**: moved to usage-based billing in March; entry tier effectively doubled
- **Momentum**: 3 senior hires in the last quarter, all in platform engineering

\`\`\`
sources: 6 pages crawled, 2 press releases, 1 pricing archive
confidence: medium-high (pricing history is inferred)
\`\`\`

Asked from: "${run.prompt}"`,
    };
  }

  return null;
}

/** Mock outcome line for a finished global run — keyed off the prompt. */
function mockGlobalOutcome(run: Run): string {
  const prompt = run.prompt.toLowerCase();
  return /email|draft/.test(prompt)
    ? 'Email draft ready'
    : /research/.test(prompt)
      ? 'Research complete'
      : /watch|monitor|remind/.test(prompt)
        ? 'Watch set up'
        : 'Background job finished';
}

/**
 * Mock completion for a global run: the work "happens elsewhere". If it
 * produced a report, that's published for the side panel first, and the
 * finished task toasted in every tab links to it. The origin tab's
 * delegated ack is cleared at the same time — the task supersedes it.
 */
function scheduleGlobalRun(run: Run) {
  setTimeout(async () => {
    const report = reportForGlobal(run);
    if (report) await publishReport(report);
    await settleTask(
      run.id,
      { status: 'done', outcome: mockGlobalOutcome(run), reportId: report?.id },
      { announce: true },
    );
    const current = (await runByTab.getValue())[tabKey(run.tabId)];
    if (current?.id === run.id) await dropRun(run.tabId);
  }, MOCK_RUN_MS);
}

/**
 * Self-reload for the "normal Chrome" dev loop (scripts/watch-build.mjs).
 * That watcher stamps build-id.txt into the output dir after each rebuild;
 * unpacked extensions serve files straight from disk, so polling our own
 * stamp reveals new builds. When it changes, reload the whole extension.
 * Store/dev-server builds have no stamp, so this returns immediately there.
 */
async function watchForRebuilds() {
  const readStamp = async () => {
    // Cast: the stamp is written post-build by the watcher, so WXT's typed
    // manifest of public paths doesn't know about it.
    const response = await fetch(browser.runtime.getURL('/build-id.txt' as never), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('no stamp');
    return (await response.text()).trim();
  };
  let known: string;
  try {
    known = await readStamp();
  } catch {
    return; // not a watch build
  }
  setInterval(() => {
    void readStamp()
      .then((current) => {
        if (current !== known) browser.runtime.reload();
      })
      .catch(() => {});
  }, 1500);
}

export default defineBackground(() => {
  void watchForRebuilds();

  // First-run setup: anonymous user + sandbox VM. Runs on every service
  // worker start but no-ops once the sandbox id is stored; failures retry
  // on the next start.
  void ensureInitialized();
  browser.runtime.onInstalled.addListener(() => void ensureInitialized());

  // Warm the active provider's auth status so the first message doesn't
  // pay the server round-trip inside RUN_START (connected is then served
  // from cache for 10 minutes).
  void ensureInitialized().then(async (vmId) => {
    if (!vmId) return;
    const selected = (await settingsItem.getValue()).provider ?? 'codex';
    void cachedProviderStatus(selected);
  });

  // First settle anything the previous service worker left mid-flight
  // (their executors died with it), then pull task and report history
  // from the DB into the session caches — this is how finished tasks
  // (and the reports they link to) from past browser sessions reappear.
  void settleOrphanedRuns().then(hydrateTasks);
  void hydrateReports();

  // Cached registrations first (pages loading right now get their scripts
  // without waiting on the network), then refresh from the DB. syncAndInject
  // also covers the switch having been enabled while no worker was alive:
  // registrations gone + enabled extensions cached → live-inject open tabs.
  void extensionsItem
    .getValue()
    .then(syncAndInject)
    .then(hydrateExtensions);

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== TOGGLE_COMMAND) return;

    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab?.id == null) return;

    try {
      await browser.tabs.sendMessage(tab.id, { type: MESSAGE.TOGGLE });
    } catch {
      // Content script may not be injected on this page (chrome://, etc.).
    }
  });

  // Extension self-diagnoses arrive from the USER_SCRIPT world on a
  // dedicated event (enabled via configureWorld({ messaging: true })).
  // Types trail the API (WXT facade + @types/chrome) — reach through
  // globalThis and cast.
  const onUserScriptMessage = (
    globalThis as unknown as {
      chrome?: {
        runtime?: {
          onUserScriptMessage?: {
            addListener(
              fn: (
                message: unknown,
                sender: { tab?: { id?: number } },
              ) => void,
            ): void;
          };
        };
      };
    }
  ).chrome?.runtime?.onUserScriptMessage;
  onUserScriptMessage?.addListener((message, sender) => {
    const report = (message as { webButlerHealth?: unknown })?.webButlerHealth;
    if (!report || typeof report !== 'object') return;
    const { id, version, status, reason, url } = report as Record<string, unknown>;
    if (typeof id !== 'string' || typeof version !== 'number') return;
    if (status !== 'ok' && status !== 'broken') return;
    void handleHealthReport(
      {
        id,
        version,
        status,
        reason: typeof reason === 'string' ? reason : undefined,
        url: typeof url === 'string' ? url : undefined,
      },
      sender.tab?.id,
    );
  });

  browser.runtime.onMessage.addListener(
    (message: WebButlerMessage, sender) => {
      // The side panel has no sender.tab — handle its messages first.
      if (message?.type === MESSAGE.PANEL_GET) {
        return panelState();
      }

      // "Open report" inside a task view: the panel is already open, so
      // this is only a focus change — no user-gesture requirement.
      if (message?.type === MESSAGE.PANEL_FOCUS_REPORT) {
        return (async () => {
          await activeReportId.setValue(message.reportId);
          await panelFocusItem.setValue({ kind: 'report' });
          await notifyPanel();
        })();
      }

      // Provider onboarding — server passthrough, no tab state involved.
      if (message?.type === MESSAGE.CODEX_LOGIN_START) {
        return startProviderLogin('codex').then((auth) => {
          cacheAuth('codex', auth);
          return auth;
        });
      }
      if (message?.type === MESSAGE.CODEX_STATUS_GET) {
        return cachedProviderStatus('codex');
      }
      if (message?.type === MESSAGE.GROK_LOGIN_START) {
        return startProviderLogin('grok').then((auth) => {
          cacheAuth('grok', auth);
          return auth;
        });
      }
      if (message?.type === MESSAGE.GROK_STATUS_GET) {
        return cachedProviderStatus('grok');
      }
      if (message?.type === MESSAGE.CLAUDE_LOGIN_START) {
        return startProviderLogin('claude').then((auth) => {
          cacheAuth('claude', auth);
          return auth;
        });
      }
      if (message?.type === MESSAGE.CLAUDE_STATUS_GET) {
        return cachedProviderStatus('claude');
      }
      if (message?.type === MESSAGE.CLAUDE_CODE_SUBMIT) {
        return submitClaudeCode(message.code).then((auth) => {
          cacheAuth('claude', auth);
          return auth;
        });
      }

      const tabId = sender.tab?.id;
      if (tabId == null) return;

      if (message?.type === MESSAGE.REPORTS_GET) {
        return reportsItem.getValue();
      }

      if (message?.type === MESSAGE.SHELL_GET) {
        return shellByTab.getValue().then((all) => {
          const merged = { ...DEFAULT_SHELL_PERSIST, ...all[tabKey(tabId)] };
          // Views get renamed between builds ('notifications' → 'tasks');
          // session storage outlives the rename, so heal stale ids.
          const known: ShellPersist['activeView'][] = [
            'tasks',
            'artifacts',
            'extensions',
            'providers',
            'settings',
          ];
          if (!known.includes(merged.activeView)) {
            merged.activeView = DEFAULT_SHELL_PERSIST.activeView;
          }
          return merged;
        });
      }

      if (message?.type === MESSAGE.SHELL_PATCH) {
        return shellByTab.getValue().then(async (all) => {
          const key = tabKey(tabId);
          const next: ShellPersist = {
            ...DEFAULT_SHELL_PERSIST,
            ...all[key],
            ...message.patch,
          };
          await shellByTab.setValue({ ...all, [key]: next });
          return next;
        });
      }

      if (message?.type === MESSAGE.RUN_START) {
        return (async (): Promise<RunStartResult> => {
          const scope = classifyRunScope(message.prompt);
          const run: Run =
            scope === 'tab'
              ? {
                  id: crypto.randomUUID(),
                  scope,
                  tabId,
                  url: message.page.url,
                  prompt: message.prompt,
                  status: 'working',
                  startedAt: Date.now(),
                }
              : {
                  // Global: the tab is released immediately — no in-page ack;
                  // completion arrives later as a finished task, everywhere.
                  id: crypto.randomUUID(),
                  scope,
                  tabId,
                  url: message.page.url,
                  prompt: message.prompt,
                  status: 'delegated',
                  startedAt: Date.now(),
                };

          // A newer prompt from this tab supersedes a still-working run:
          // settle its task as stopped NOW. Its executor's stale check
          // will skip settling later, so this is the only place that
          // records the supersede — without it the old task runs forever.
          // (A 'delegated' entry is just the ack card; its global task is
          // still executing and settles itself.)
          const previous = (await runByTab.getValue())[tabKey(tabId)];
          if (previous && previous.status === 'working') {
            await settleTask(previous.id, { status: 'stopped' });
          }

          // Optimistic: the task is in every tab's list before the (slow)
          // auth check. A rejection below rolls it back.
          await saveRun(run);
          await trackTask(run);

          // Route to the active provider from settings; if it isn't
          // connected, any other connected provider still runs the task.
          // Nothing connected → reject; the shell pops the sign-in gate
          // with this auth state.
          const bypass = await devBypassAuth.getValue();
          let provider: DeviceAuthProvider | null = null;
          if (!bypass) {
            const selected =
              (await settingsItem.getValue()).provider ?? 'codex';
            const order: DeviceAuthProvider[] = [
              selected,
              ...(['codex', 'grok', 'claude'] as const).filter(
                (p) => p !== selected,
              ),
            ];
            let codexAuth: ProviderAuth = { status: 'unknown' };
            for (const candidate of order) {
              const auth = await cachedProviderStatus(candidate);
              if (candidate === 'codex') codexAuth = auth;
              if (auth.status === 'connected') {
                provider = candidate;
                break;
              }
            }
            if (!provider) {
              await untrackTask(run.id);
              await dropRun(run.tabId);
              // The gate card defaults to the ChatGPT flow, so report codex.
              return { authRequired: true, auth: codexAuth };
            }
          }

          // The run will really execute — now it's history worth keeping.
          void syncTask(taskFor(run));

          if (provider) {
            // Real run: one ACP turn against the agent CLI on the VM. The
            // page context rides along in memory only — never persisted
            // (an HTML snapshot is too big for session storage to keep).
            // guardRun settles the task if the executor itself crashes.
            if (scope === 'tab')
              guardRun(run, executeTabRun(run, provider, message.page));
            else guardRun(run, executeGlobalRun(run, provider, message.page));
          } else {
            // Dev bypass: canned fixture answers, no VM involved.
            if (scope === 'tab') scheduleTabRun(run);
            else scheduleGlobalRun(run);
          }
          return run;
        })();
      }

      if (message?.type === MESSAGE.RUN_GET) {
        return runByTab
          .getValue()
          .then((all) => all[tabKey(tabId)] ?? null);
      }

      if (message?.type === MESSAGE.RUN_CLEAR) {
        return (async () => {
          // Dismissing a still-working run is a stop — record it as such.
          const current = (await runByTab.getValue())[tabKey(tabId)];
          if (current && current.status !== 'done') {
            await settleTask(current.id, { status: 'stopped' });
          }
          await dropRun(tabId);
        })();
      }

      if (message?.type === MESSAGE.TASKS_GET) {
        return tasksItem.getValue();
      }

      if (message?.type === MESSAGE.EXTENSIONS_GET) {
        return extensionsState();
      }

      if (message?.type === MESSAGE.USER_SCRIPTS_SETTINGS_OPEN) {
        // The extension's own details page — the "Allow User Scripts"
        // switch lives there. Content scripts can't open chrome:// URLs;
        // the background can. One text-fragment RANGE from the switch's
        // label through the end of its consent paragraph scrolls there and
        // paints the whole row's text as a single block, so the user lands
        // with the exact control lit up instead of hunting the page. (The
        // row's #allow-user-scripts element id would be neater, but
        // fragment navigation can't reach into the page's shadow DOM, and
        // chrome:// pages can't be scripted to draw a custom ring.)
        const highlight =
          '#:~:text=Allow%20User%20Scripts,know%20what%20you%20are%20doing.';
        return browser.tabs
          .create({
            url: `chrome://extensions/?id=${browser.runtime.id}${highlight}` as never,
          })
          .then(() => undefined)
          .catch(() => undefined);
      }

      if (message?.type === MESSAGE.EXTENSIONS_TOGGLE) {
        return (async (): Promise<ExtensionsState> => {
          const extensions = (await extensionsItem.getValue()).map((ext) =>
            ext.id === message.id ? { ...ext, enabled: message.enabled } : ext,
          );
          const toggled = extensions.find((ext) => ext.id === message.id);
          // Local first (instant everywhere), server after — a missed sync
          // self-heals on the next hydrate.
          await setExtensions(extensions);
          if (toggled) {
            if (message.enabled) void applyToOpenTabs(toggled);
            else void removeFromOpenTabs(toggled);
          }
          void patchExtension(message.id, message.enabled);
          return extensionsState();
        })();
      }

      if (message?.type === MESSAGE.EXTENSIONS_DELETE) {
        return (async (): Promise<ExtensionsState> => {
          const extensions = await extensionsItem.getValue();
          const removed = extensions.find((ext) => ext.id === message.id);
          await setExtensions(
            extensions.filter((ext) => ext.id !== message.id),
          );
          if (removed) void removeFromOpenTabs(removed);
          void deleteExtension(message.id);
          return extensionsState();
        })();
      }

      if (message?.type === MESSAGE.TASKS_DELETE) {
        return removeTasks((task) => task.id !== message.id).then(() =>
          deleteTaskRemote(message.id),
        );
      }

      if (message?.type === MESSAGE.TASKS_CLEAR) {
        const keep =
          message.mode === 'old'
            ? (task: Task) => task.status === 'running'
            : () => false;
        return removeTasks(keep).then(() => clearTasksRemote(message.mode));
      }

      if (message?.type === MESSAGE.TASKS_SEEN) {
        return tasksItem.getValue().then(async (tasks) => {
          if (tasks.every((task) => task.seen)) return;
          const next = tasks.map((task) =>
            task.seen ? task : { ...task, seen: true },
          );
          await tasksItem.setValue(next);
          void syncTasksSeen();
          // Sync badges in every other tab too.
          await broadcast({ type: MESSAGE.TASKS_CHANGED, tasks: next });
        });
      }

      if (message?.type === MESSAGE.SIDE_PANEL_OPEN) {
        // sidePanel.open needs the user gesture that triggered the message,
        // which Chrome honors for content-script clicks. Open synchronously
        // so the gesture isn't lost to the storage writes. If it still
        // fails (gesture expired, API missing), fall back to a full tab so
        // the button never silently does nothing.
        const open = browser.sidePanel
          ? browser.sidePanel.open({ tabId })
          : Promise.reject(new Error('sidePanel API unavailable'));
        void open.catch((error) => {
          console.warn('[web-butler] sidePanel.open failed:', error);
          return browser.tabs
            .create({ url: browser.runtime.getURL('/sidepanel.html') })
            .catch(() => {});
        });
        // Targeting a specific artifact or a live task: focus it and
        // refresh an already-open panel.
        if (message.taskId) {
          const taskId = message.taskId;
          void panelFocusItem
            .setValue({ kind: 'task', taskId })
            .then(notifyPanel);
        } else if (message.reportId) {
          void reportsItem.getValue().then(async (reports) => {
            const report = reports.find((r) => r.id === message.reportId);
            if (!report) return;
            await activeReportId.setValue(report.id);
            await panelFocusItem.setValue({ kind: 'report' });
            await notifyPanel();
          });
        }
        return;
      }
    },
  );

  // Drop per-tab state when the tab goes away so keys don't accumulate.
  browser.tabs.onRemoved.addListener((tabId) => {
    const key = tabKey(tabId);
    void shellByTab.getValue().then((all) => {
      if (!(key in all)) return;
      const { [key]: _removed, ...rest } = all;
      return shellByTab.setValue(rest);
    });
    void dropRun(tabId);
  });
});
