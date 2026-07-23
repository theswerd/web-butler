import { storage } from 'wxt/utils/storage';
import type {
  BrowserAction,
  BrowserActionResult,
  OpenTab,
  PageContext,
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
const SERVER_URL = 'http://localhost:8787';

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
  | { text: string; stopReason: string; outcomes: AgentOutcome[] }
  | { error: string };

/**
 * Watchdogs for the agent stream. The server heartbeats every 20s even
 * when the agent is quiet, so prolonged byte-silence means the connection
 * or server is actually dead — not a slow tool call. The overall cap is a
 * backstop against a turn that streams forever without ever finishing.
 * Both settle the run as a failed turn instead of leaving it "working".
 */
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 30 * 60_000;

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
  /** Streamed session updates (activity feed). */
  onUpdate?: (update: Record<string, unknown>) => void;
  /** A browser action the agent requested — perform it and return the
      result. The turn's stream stays open while this runs. */
  onAction?: (action: BrowserAction) => Promise<BrowserActionResult>;
  /** User-initiated cancel (the task chip's stop). Aborting propagates
      through the server's request signal and cancels the agent turn on
      the VM — not just our read of it. */
  signal?: AbortSignal;
};

/**
 * Run one agent turn on the sandbox VM via the server's ACP bridge.
 * The response is NDJSON: `{"update"}` lines stream while the agent works
 * (forwarded to `onUpdate`), `{"action"}` lines request a browser action
 * (handed to `onAction`, whose result is POSTed back out-of-band), and
 * exactly one terminal line carries either the outcomes (with the raw
 * reply text) or an error.
 */
export async function runAgentPrompt(
  opts: RunAgentOptions,
): Promise<AgentTurnOutcome> {
  const { provider, prompt, page, taskId, openTabs, onUpdate, onAction, signal } =
    opts;
  // Aborting the fetch propagates through the server's request signal and
  // cancels the actual agent turn on the VM — not just our read of it.
  const abort = new AbortController();
  let timeoutError: string | null = null;
  const fail = (reason: string) => {
    timeoutError = reason;
    abort.abort();
  };
  // The caller's stop button funnels into the same abort as the watchdogs.
  if (signal?.aborted) fail('Stopped.');
  signal?.addEventListener('abort', () => fail('Stopped.'), { once: true });
  let idleTimer = setTimeout(() => {}, 0);
  const armIdle = () =>
    (idleTimer = setTimeout(
      () => fail('The agent stopped responding. It may have hit a snag on the server.'),
      STREAM_IDLE_TIMEOUT_MS,
    ));
  const turnTimer = setTimeout(
    () => fail('The task ran for 30 minutes without finishing, so it was stopped.'),
    TURN_TIMEOUT_MS,
  );

  try {
    if (!(await ensureInitialized())) {
      return { error: 'Sandbox not ready yet' };
    }
    const response = await authedFetch('/api/agent/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, prompt, page, taskId, openTabs }),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      return {
        error: body?.error ?? `agent request failed: ${response.status}`,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outcome: AgentTurnOutcome | null = null;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let message: {
        update?: Record<string, unknown>;
        action?: BrowserAction;
        done?: boolean;
        stopReason?: string;
        text?: string;
        outcomes?: AgentOutcome[];
        error?: string;
      };
      try {
        message = JSON.parse(line);
      } catch {
        return; // torn frame — the terminal line is what matters
      }
      if (message.update) onUpdate?.(message.update);
      else if (message.action) {
        // Perform it off the read loop so the stream keeps draining
        // (heartbeats, further lines) while the cursor animates. The
        // result rides back to the server on its own request.
        const requested = message.action;
        if (onAction) {
          void onAction(requested)
            .catch((error: unknown) => ({
              ok: false as const,
              error:
                error instanceof Error ? error.message : 'browser action failed',
            }))
            .then((result) => postActionResult(requested.id, result));
        } else {
          void postActionResult(requested.id, {
            ok: false,
            error: 'this browser cannot perform actions right now',
          });
        }
      } else if (message.done) {
        const text = message.text ?? '';
        outcome = {
          text,
          stopReason: message.stopReason ?? 'end_turn',
          // Older servers won't send outcomes; degrade like they do.
          outcomes: message.outcomes ?? [
            { type: 'response', markdown: text || 'Done.' },
          ],
        };
      } else if (message.error) outcome = { error: message.error };
    };

    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      // Any bytes at all (updates or the server's 20s heartbeats) prove
      // the connection is alive — re-arm the silence watchdog.
      clearTimeout(idleTimer);
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    handleLine(buffer);

    return outcome ?? { error: 'The agent stream ended unexpectedly' };
  } catch {
    return { error: timeoutError ?? 'Could not reach the server' };
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(turnTimer);
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
