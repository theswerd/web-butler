import { storage } from 'wxt/utils/storage';
import type {
  BrowserAction,
  BrowserActionResult,
  OpenAnswerContext,
  OpenTab,
  PageContext,
  PageHighlight,
  ProviderAuth,
  Report,
  SiteExtension,
  Task,
  TaskUpdate,
} from '@web-butler/ui/shell';

/**
 * First-run initialization against the Web Butler server.
 *
 * Flow: sign in anonymously (Better Auth `anonymous` plugin — no account
 * UI), keep the bearer token from the `set-auth-token` header (cookie jars
 * are unreliable in MV3 service workers), then POST /api/init, which lazily
 * provisions the user's Freestyle sandbox VM and returns its id.
 */
/**
 * Local dev server by default; public builds override it at build time
 * (`npm run build:prod` points at the deployed Cloudflare Worker).
 */
const SERVER_URL = import.meta.env.WXT_SERVER_URL || 'http://localhost:8787';

/** Survives browser restarts — this IS the anonymous identity. */
const authTokenItem = storage.defineItem<string | null>('local:authToken', {
  fallback: null,
});
const sandboxVmIdItem = storage.defineItem<string | null>(
  'local:sandboxVmId',
  { fallback: null },
);

async function signInAnonymously(): Promise<string> {
  // credentials: 'omit' — Better Auth also drops a session cookie on the
  // server origin, and if a stale one rides along on a FRESH sign-in the
  // anonymous plugin rejects with "Anonymous users cannot sign in again
  // anonymously" (400), wedging init forever. Identity here is purely the
  // bearer token; cookies must never participate.
  const response = await fetch(`${SERVER_URL}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`anonymous sign-in failed: ${response.status}`);
  }
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('anonymous sign-in returned no auth token');
  await authTokenItem.setValue(token);
  return token;
}

/**
 * Fetch with the stored bearer token, transparently recovering from a
 * stale identity: a 401 gets one retry under a fresh anonymous sign-in.
 */
async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  let token = await authTokenItem.getValue();
  if (!token) token = await signInAnonymously();

  const request = (t: string) =>
    fetch(`${SERVER_URL}${path}`, {
      ...init,
      // Cookie-free (see signInAnonymously) — the bearer token IS the
      // identity, and a mismatched leftover session cookie must not vote.
      credentials: 'omit',
      headers: { ...init?.headers, Authorization: `Bearer ${t}` },
    });

  let response = await request(token);
  if (response.status === 401) {
    token = await signInAnonymously();
    response = await request(token);
  }
  return response;
}

/**
 * Idempotent; safe to call on every service worker start. Fast path: the
 * sandbox id is already stored and nothing touches the network. Returns
 * the sandbox VM id, or null when the server is unreachable / has no
 * Freestyle credential — callers treat that as "not initialized yet" and
 * the next start retries.
 */
export function ensureInitialized(): Promise<string | null> {
  // Single-flight: on a fresh profile, SW start, onInstalled, and the first
  // page's status fetch all call this at once — without coalescing, each
  // racer would mint its own anonymous user AND its own VM.
  initInFlight ??= initialize().finally(() => {
    initInFlight = null;
  });
  return initInFlight;
}

let initInFlight: Promise<string | null> | null = null;

async function initialize(): Promise<string | null> {
  const known = await sandboxVmIdItem.getValue();
  if (known) return known;

  try {
    const response = await authedFetch('/api/init', { method: 'POST' });
    if (!response.ok) {
      throw new Error(`init failed: ${response.status}`);
    }

    const body: { sandbox: { vmId: string; created: boolean } } =
      await response.json();
    await sandboxVmIdItem.setValue(body.sandbox.vmId);
    console.log(
      `[web-butler] initialized — sandbox ${body.sandbox.vmId}` +
        (body.sandbox.created ? ' (created)' : ''),
    );
    return body.sandbox.vmId;
  } catch (error) {
    console.warn('[web-butler] initialization deferred:', error);
    return null;
  }
}

/**
 * Is the server reachable at all? A fast, unauthenticated liveness probe
 * for the shell's availability notice — distinct from provider status,
 * which requires the server AND the user's VM to answer.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5_000);
    const response = await fetch(`${SERVER_URL}/health`, {
      signal: abort.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/** Providers with a device-code login flow on the sandbox VM. */
export type DeviceAuthProvider = 'codex' | 'grok' | 'claude';

/**
 * Kick off a provider's device-code login on the user's sandbox VM.
 * Resolves to `pending` with the code + URL the user needs, or `failed`
 * when the server / VM can't produce one.
 */
export async function startProviderLogin(
  provider: DeviceAuthProvider,
): Promise<ProviderAuth> {
  try {
    if (!(await ensureInitialized())) {
      return { status: 'failed', error: 'Sandbox not ready yet' };
    }
    const response = await authedFetch(
      `/api/providers/${provider}/login/start`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        status: 'failed',
        error: body?.error ?? `login start failed: ${response.status}`,
      };
    }
    return await response.json();
  } catch (error) {
    console.warn(`[web-butler] ${provider} login start failed:`, error);
    return { status: 'failed', error: 'Could not reach the server' };
  }
}

/**
 * Claude's reverse flow: forward the code the user pasted (from Anthropic's
 * OAuth page) to the CLI waiting on the VM. Still `pending` on success —
 * the status poll flips to connected once the CLI finishes the exchange.
 */
export async function submitClaudeCode(code: string): Promise<ProviderAuth> {
  try {
    const response = await authedFetch('/api/providers/claude/login/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        status: 'failed',
        error: body?.error ?? `code submit failed: ${response.status}`,
      };
    }
    return await response.json();
  } catch {
    return { status: 'failed', error: 'Could not reach the server' };
  }
}

/**
 * What the agent declared it produced (the Web Butler outcome contract,
 * written to a JSON file on the VM and read back by the server). Today a
 * short markdown response or a long-form artifact; extensions and actions
 * join this union later.
 */
export type AgentOutcome =
  | { type: 'response'; markdown: string }
  | {
      type: 'artifact';
      title: string;
      description?: string;
      markdown: string;
    }
  | {
      // A site extension the server already stored (create/update) or
      // removed (delete); `id` is always present after processing.
      type: 'extension';
      action: 'create' | 'update' | 'delete';
      id: string;
      name: string;
      description: string;
      urlPatterns: string[];
      stage: SiteExtension['stage'];
      script: string;
    };

/** How an agent turn ended: the declared outcomes, or what went wrong. */
export type AgentTurnOutcome =
  | {
      text: string;
      stopReason: string;
      outcomes: AgentOutcome[];
      /** Follow-up prompts the agent offered — the task's "suggested
          next" chips. */
      suggestions?: string[];
      /** Page sections the agent flagged — marker overlays on the origin
          tab, navigated via highlight: links in the outcome markdown. */
      highlights?: PageHighlight[];
    }
  | { error: string };

/**
 * Watchdogs for the turn poll loop. Staleness detection lives server-side
 * now (the daemon heartbeats the turn row; a quiet row gets failed on
 * read), so the client only needs an overall cap — a backstop against a
 * turn that "runs" forever — and a tolerance for transient poll failures.
 */
const TURN_TIMEOUT_MS = 30 * 60_000;
/** Poll cadence while a turn runs. Browser actions ride the same poll, so
    this also bounds the ghost cursor's reaction time. */
const TURN_POLL_MS = 900;
/** Consecutive failed polls before the connection is declared dead. */
const TURN_POLL_MAX_FAILURES = 12;

/**
 * Post one browser action's result back to the waiting turn, unblocking
 * the `browser` CLI on the VM. Fire-and-forget from the caller's view: a
 * dropped result just lets the CLI (and the server) time the action out.
 */
export async function postActionResult(
  id: string,
  result: BrowserActionResult,
): Promise<void> {
  try {
    await authedFetch('/api/agent/action-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, result }),
    });
  } catch {
    // Server unreachable — the action times out on both ends.
  }
}

export type RunAgentOptions = {
  provider: DeviceAuthProvider;
  prompt: string;
  page?: PageContext;
  taskId?: string;
  /** The user's open tabs, for envelope context + browser control. */
  openTabs?: OpenTab[];
  /** The answer on the user's screen at send time — implicit context for
      unnamed follow-ups ("make it shorter", "what about the second one"). */
  openAnswer?: OpenAnswerContext;
  /** Streamed session updates (activity feed). */
  onUpdate?: (update: Record<string, unknown>) => void;
  /** A browser action the agent requested — perform it and return the
      result. The turn's stream stays open while this runs. */
  onAction?: (action: BrowserAction) => Promise<BrowserActionResult>;
  /** The server-side job id for this turn, announced as the stream's first
      line. Record it: the turn survives a dropped stream (and a recycled
      service worker) and can be picked back up with `attachAgentTurn`. */
  onJob?: (jobId: string) => void;
  /** Highest replay cursor seen so far — pass it back as `since` when
      re-attaching so already-seen updates aren't replayed. */
  onSeq?: (seq: number) => void;
  /** Stops READING this turn. It does not cancel the agent on the VM —
      that's `cancelAgentTask`, which the stop button calls alongside. */
  signal?: AbortSignal;
};

type TurnStreamHandlers = Pick<
  RunAgentOptions,
  'onUpdate' | 'onAction' | 'onJob' | 'onSeq' | 'signal'
>;

/** Terminal errors that mean the CONNECTION died, not the turn: the turn
    row is likely still live server-side and worth re-attaching to. */
const TRANSPORT_ERRORS = new Set(['Could not reach the server']);

export function isTransportError(error: string): boolean {
  return TRANSPORT_ERRORS.has(error);
}

/** The poll said 404: the server no longer knows the turn (it was swept,
    or never existed). Nothing left to re-attach to. */
export const TURN_GONE_ERROR = 'turn-gone';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One poll response from GET /api/agent/turn/:id. */
type TurnPollData = {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  updates?: Array<{ seq: number; updates: Record<string, unknown>[] }>;
  actions?: BrowserAction[];
  text?: string;
  stopReason?: string;
  outcomes?: AgentOutcome[];
  suggestions?: string[];
  highlights?: PageHighlight[];
  error?: string;
};

/**
 * Poll one turn row to its terminal state. Turns are rows in the server's
 * database, executed by the daemon on the user's VM — this loop is just a
 * window onto that row: update batches after the cursor stream to
 * `onUpdate`, pending browser actions are performed (results ride back on
 * their own request), and the terminal payload lands when the row settles.
 * A dropped poll costs one tick, never the turn; a recycled service worker
 * resumes by calling this again with the stored cursor.
 */
async function pollTurnToTerminal(
  turnId: string,
  since: number,
  handlers: TurnStreamHandlers,
): Promise<AgentTurnOutcome> {
  const { onUpdate, onAction, onSeq, signal } = handlers;
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  /** Actions dispatched by THIS loop — pending rows repeat on every poll
      until the result lands, and a click must not double-fire. */
  const dispatched = new Set<string>();
  let cursor = since;
  let failures = 0;

  for (;;) {
    if (signal?.aborted) return { error: 'Stopped.' };
    if (Date.now() > deadline) {
      return {
        error: 'The task ran for 30 minutes without finishing, so it was stopped.',
      };
    }

    let data: TurnPollData | null = null;
    try {
      const response = await authedFetch(
        `/api/agent/turn/${turnId}?since=${cursor}`,
        { signal },
      );
      if (response.status === 404) return { error: TURN_GONE_ERROR };
      if (response.ok) {
        data = (await response.json()) as TurnPollData;
        failures = 0;
      } else {
        failures++;
      }
    } catch {
      if (signal?.aborted) return { error: 'Stopped.' };
      failures++;
    }
    if (failures > TURN_POLL_MAX_FAILURES) {
      return { error: 'Could not reach the server' };
    }
    if (data) {
      for (const batch of data.updates ?? []) {
        if (batch.seq > cursor) {
          cursor = batch.seq;
          onSeq?.(cursor);
        }
        for (const update of batch.updates ?? []) onUpdate?.(update);
      }
      for (const action of data.actions ?? []) {
        if (!action?.id || dispatched.has(action.id)) continue;
        dispatched.add(action.id);
        // Perform it off the poll loop so updates keep flowing while the
        // cursor animates. The result rides back on its own request.
        if (onAction) {
          void onAction(action)
            .catch((error: unknown) => ({
              ok: false as const,
              error:
                error instanceof Error ? error.message : 'browser action failed',
            }))
            .then((result) => postActionResult(action.id, result));
        } else {
          void postActionResult(action.id, {
            ok: false,
            error: 'this browser cannot perform actions right now',
          });
        }
      }
      if (data.status === 'done' || data.status === 'cancelled') {
        const text = data.text ?? '';
        return {
          text,
          stopReason: data.stopReason ?? 'end_turn',
          outcomes: data.outcomes ?? [
            { type: 'response', markdown: text || 'Done.' },
          ],
          suggestions: data.suggestions,
          highlights: data.highlights,
        };
      }
      if (data.status === 'failed') {
        return { error: data.error ?? 'agent turn failed' };
      }
    }
    await sleep(TURN_POLL_MS * (failures > 0 ? failures : 1));
  }
}

/**
 * Start one agent turn: enqueue it on the server (which wakes the VM
 * daemon that executes it) and poll the row to its terminal. The turn is
 * a database row, fully detached from this call: if the poll dies (worker
 * recycled, network blip), the turn keeps going — use the id from `onJob`
 * with `attachAgentTurn` to pick it back up.
 */
export async function runAgentPrompt(
  opts: RunAgentOptions,
): Promise<AgentTurnOutcome> {
  const { provider, prompt, page, taskId, openTabs, openAnswer } = opts;
  try {
    if (!(await ensureInitialized())) {
      return { error: 'Sandbox not ready yet' };
    }
    const response = await authedFetch('/api/agent/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, prompt, page, taskId, openTabs, openAnswer }),
      signal: opts.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        error: body?.error ?? `agent request failed: ${response.status}`,
      };
    }
    const { turn } = (await response.json()) as { turn: string };
    if (typeof turn !== 'string') {
      return { error: 'The server did not accept the task' };
    }
    opts.onJob?.(turn);
    return await pollTurnToTerminal(turn, 0, opts);
  } catch {
    return opts.signal?.aborted
      ? { error: 'Stopped.' }
      : { error: 'Could not reach the server' };
  }
}

export type AttachAgentOptions = TurnStreamHandlers & {
  /** The turn id announced by the original run's `onJob`. */
  jobId: string;
  /** Last seq this client saw — polling resumes after it. */
  since?: number;
};

/**
 * Re-attach to a turn whose poller died (recycled service worker, dropped
 * connection). Missed update batches replay from `since`, pending browser
 * actions are re-delivered, and the turn settles exactly like the original
 * call would have. `TURN_GONE_ERROR` means the server no longer knows the
 * turn — the task is genuinely dead.
 */
export async function attachAgentTurn(
  opts: AttachAgentOptions,
): Promise<AgentTurnOutcome> {
  try {
    if (!(await ensureInitialized())) {
      return { error: 'Sandbox not ready yet' };
    }
    opts.onJob?.(opts.jobId);
    return await pollTurnToTerminal(opts.jobId, opts.since ?? 0, opts);
  } catch {
    return opts.signal?.aborted
      ? { error: 'Stopped.' }
      : { error: 'Could not reach the server' };
  }
}

/**
 * Cancel a task's turns on the server. Since disconnects no longer cancel
 * anything, this is the only way to actually stop the agent on the VM.
 * Fire-and-forget: if it doesn't land, the turn just runs to completion
 * and settles a task the user already marked stopped (first settle wins).
 */
export async function cancelAgentTask(taskId: string): Promise<void> {
  try {
    await authedFetch('/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    // Unreachable server — nothing to cancel there anyway.
  }
}

/**
 * Page-specific starter prompts for the empty prompt box, generated by
 * the active provider's agent through the same turn queue as real tasks
 * (cached server-side per page). The POST answers instantly from cache or
 * hands back a pending turn id to poll. Starters are decoration: every
 * failure mode — offline, provider not signed in, thin page, slow agent —
 * collapses to "no chips" rather than an error.
 */
const STARTERS_POLL_MS = 2_500;
const STARTERS_POLL_BUDGET_MS = 80_000;

export async function fetchStarters(opts: {
  provider: DeviceAuthProvider;
  url: string;
  title: string;
  /** Compact page digest (capturePageSignal). */
  signal: string;
}): Promise<string[]> {
  const asStarters = (data: { starters?: unknown }) =>
    Array.isArray(data.starters)
      ? data.starters.filter((s): s is string => typeof s === 'string')
      : [];
  try {
    if (!(await ensureInitialized())) return [];
    const response = await authedFetch('/api/agent/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      starters?: unknown;
      pending?: boolean;
      turn?: string;
    };
    if (!data.pending || typeof data.turn !== 'string') {
      return asStarters(data);
    }
    const deadline = Date.now() + STARTERS_POLL_BUDGET_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, STARTERS_POLL_MS));
      const poll = await authedFetch(`/api/agent/suggest/${data.turn}`);
      if (!poll.ok) return [];
      const state = (await poll.json()) as {
        starters?: unknown;
        pending?: boolean;
      };
      if (!state.pending) return asStarters(state);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Task history sync. The background's session cache is the fast surface
 * every tab reads; these mirror it into the server's DB so history
 * survives browser restarts. Writes are fire-and-forget from the caller's
 * perspective: a missed sync loses durability, never UI state.
 */
/** A task as the server returns it: the row plus its stored activity
    feed, so old tasks can replay in the side panel across sessions. */
export type StoredTask = Task & { updates?: TaskUpdate[] };

export async function fetchTasks(): Promise<StoredTask[] | null> {
  try {
    if (!(await ensureInitialized())) return null;
    const response = await authedFetch('/api/tasks');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function syncTask(
  task: Task,
  updates?: TaskUpdate[],
): Promise<void> {
  try {
    await authedFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        updates && updates.length > 0 ? { ...task, updates } : task,
      ),
    });
  } catch {
    // Offline / server down — the session cache still has it.
  }
}

export async function syncTasksSeen(): Promise<void> {
  try {
    await authedFetch('/api/tasks/seen', { method: 'POST' });
  } catch {
    // Same: seen state re-syncs the next time everything is marked seen.
  }
}

/**
 * Reports: same durability contract as tasks. Publishing syncs the row up;
 * hydration on service-worker start pulls history back down, so the
 * Artifacts view and old tasks' "Open report" links outlive the browser.
 */
export async function fetchReports(): Promise<Report[] | null> {
  try {
    if (!(await ensureInitialized())) return null;
    const response = await authedFetch('/api/reports');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function syncReport(report: Report): Promise<void> {
  try {
    await authedFetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // Offline — the session cache still has it; it's just not durable.
  }
}

export async function deleteReportRemote(id: string): Promise<void> {
  try {
    await authedFetch(`/api/reports/${id}`, { method: 'DELETE' });
  } catch {
    // Offline — the row resurfaces on the next hydrate; delete again then.
  }
}

export async function clearReportsRemote(): Promise<void> {
  try {
    await authedFetch('/api/reports/all', { method: 'DELETE' });
  } catch {
    // Same offline story as deleteReportRemote.
  }
}

export async function deleteTaskRemote(id: string): Promise<void> {
  try {
    await authedFetch(`/api/tasks/${id}`, { method: 'DELETE' });
  } catch {
    // Offline — the row resurfaces on the next hydrate; delete again then.
  }
}

/** Bulk delete: 'old' clears settled history, 'all' everything. */
export async function clearTasksRemote(mode: 'old' | 'all'): Promise<void> {
  try {
    await authedFetch(
      `/api/tasks/all${mode === 'old' ? '?mode=settled' : ''}`,
      { method: 'DELETE' },
    );
  } catch {
    // Same offline story as deleteTaskRemote.
  }
}

/**
 * Site extensions: the DB is the source of truth (agent outcomes are
 * stored server-side); the background mirrors it into a local cache and
 * chrome.userScripts registrations.
 */
export async function fetchExtensions(): Promise<SiteExtension[] | null> {
  try {
    if (!(await ensureInitialized())) return null;
    const response = await authedFetch('/api/extensions');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function patchExtension(
  id: string,
  enabled: boolean,
): Promise<SiteExtension | null> {
  try {
    const response = await authedFetch(`/api/extensions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function deleteExtension(id: string): Promise<boolean> {
  try {
    const response = await authedFetch(`/api/extensions/${id}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** A provider's auth state on the sandbox VM — poll this while `pending`. */
export async function getProviderAuthStatus(
  provider: DeviceAuthProvider,
): Promise<ProviderAuth> {
  try {
    if (!(await ensureInitialized())) return { status: 'unknown' };
    const response = await authedFetch(`/api/providers/${provider}/status`);
    if (!response.ok) return { status: 'unknown' };
    return await response.json();
  } catch {
    return { status: 'unknown' };
  }
}
