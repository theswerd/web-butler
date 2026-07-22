import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  MESSAGE,
  type ExtensionsState,
  type PageContext,
  type Report,
  type Run,
  type RunStartResult,
  type SiteExtension,
  type Task,
  type WebButlerMessage,
} from '@web-butler/ui/shell';

/**
 * The two visibility scopes of agent state, as seen from one tab:
 *
 *  - useRun   — THIS tab's run. Tab-scoped answers render only here; a
 *               global run leaves behind just a short-lived delegated ack.
 *  - useTasks — the session-wide activity list (every run, ongoing or
 *               finished). Identical in every tab; the background
 *               broadcasts every change so badges, the Tasks view, and
 *               completion toasts stay in sync everywhere.
 */

export function useRun(): {
  run: Run | null;
  /** Resolves with the run, or the auth rejection the caller must surface. */
  start: (prompt: string, page: PageContext) => Promise<RunStartResult | null>;
  clear: () => void;
} {
  const [run, setRun] = useState<Run | null>(null);

  // Re-sync after reload/navigation, then listen for this tab's completions.
  useEffect(() => {
    let mounted = true;
    void browser.runtime
      .sendMessage({ type: MESSAGE.RUN_GET })
      .then((stored: Run | null) => {
        if (mounted && stored) setRun(stored);
      })
      .catch(() => {});

    const onMessage = (message: WebButlerMessage) => {
      if (message?.type === MESSAGE.RUN_DONE) setRun(message.run);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  const start = useCallback(
    async (prompt: string, page: PageContext): Promise<RunStartResult | null> => {
      try {
        const result: RunStartResult = await browser.runtime.sendMessage({
          type: MESSAGE.RUN_START,
          prompt,
          page,
        });
        if (result && !('authRequired' in result)) setRun(result);
        return result;
      } catch {
        return null;
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setRun(null);
    void browser.runtime.sendMessage({ type: MESSAGE.RUN_CLEAR }).catch(() => {});
  }, []);

  return { run, start, clear };
}

export function useTasks(): {
  tasks: Task[];
  /** Finished-but-unseen count — what badges show. */
  unseen: number;
  /** The task that just finished off-tab — render as a toast, then clear. */
  finished: Task | null;
  clearFinished: () => void;
  /** User opened the Tasks view: mark everything seen, in every tab. */
  markSeen: () => void;
  /** Trash one row (running rows vanish; the work isn't cancelled). */
  removeTask: (id: string) => void;
  /** Bulk trash: 'old' clears settled history, 'all' empties the list. */
  clearTasks: (mode: 'old' | 'all') => void;
} {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [finished, setFinished] = useState<Task | null>(null);

  useEffect(() => {
    let mounted = true;
    void browser.runtime
      .sendMessage({ type: MESSAGE.TASKS_GET })
      .then((stored: Task[] | undefined) => {
        if (mounted && stored) setTasks(stored);
      })
      .catch(() => {});

    const onMessage = (message: WebButlerMessage) => {
      if (message?.type !== MESSAGE.TASKS_CHANGED) return;
      setTasks(message.tasks);
      if (message.finished) setFinished(message.finished);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  const markSeen = useCallback(() => {
    // Optimistic: the broadcast will confirm, but don't wait for it.
    setTasks((current) =>
      current.map((task) => (task.seen ? task : { ...task, seen: true })),
    );
    void browser.runtime
      .sendMessage({ type: MESSAGE.TASKS_SEEN })
      .catch(() => {});
  }, []);

  const clearFinished = useCallback(() => setFinished(null), []);

  // Both optimistic, like markSeen: the broadcast confirms.
  const removeTask = useCallback((id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    void browser.runtime
      .sendMessage({ type: MESSAGE.TASKS_DELETE, id })
      .catch(() => {});
  }, []);

  const clearTasks = useCallback((mode: 'old' | 'all') => {
    setTasks((current) =>
      mode === 'old'
        ? current.filter((task) => task.status === 'running')
        : [],
    );
    void browser.runtime
      .sendMessage({ type: MESSAGE.TASKS_CLEAR, mode })
      .catch(() => {});
  }, []);

  const unseen = tasks.filter((task) => !task.seen).length;

  return {
    tasks,
    unseen,
    finished,
    clearFinished,
    markSeen,
    removeTask,
    clearTasks,
  };
}

/**
 * The user's site extensions — global state like tasks: identical in every
 * tab, owned by the background (which also keeps chrome.userScripts in
 * sync), refreshed by broadcast. Toggle/delete are optimistic: the
 * background answers with the settled state and broadcasts it everywhere.
 */
export function useExtensions(): {
  state: ExtensionsState;
  toggle: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
} {
  const [state, setState] = useState<ExtensionsState>({
    extensions: [],
    userScriptsAvailable: true,
  });

  useEffect(() => {
    let mounted = true;
    const fetch = () =>
      browser.runtime
        .sendMessage({ type: MESSAGE.EXTENSIONS_GET })
        .then((stored: ExtensionsState | undefined) => {
          if (mounted && stored) setState(stored);
        })
        .catch(() => {});
    void fetch();

    const onMessage = (message: WebButlerMessage) => {
      if (message?.type === MESSAGE.EXTENSIONS_CHANGED) setState(message.state);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // Chrome's user-scripts switch flips silently (no event, no broadcast) —
  // while it's off, poll so the blocked banner clears itself the moment
  // it's enabled. Each poll also lets the background notice the flip and
  // register the cached scripts.
  useEffect(() => {
    if (state.userScriptsAvailable) return;
    const interval = window.setInterval(() => {
      void browser.runtime
        .sendMessage({ type: MESSAGE.EXTENSIONS_GET })
        .then((stored: ExtensionsState | undefined) => {
          if (stored) setState(stored);
        })
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(interval);
  }, [state.userScriptsAvailable]);

  const toggle = useCallback((id: string, enabled: boolean) => {
    setState((current) => ({
      ...current,
      extensions: current.extensions.map((ext) =>
        ext.id === id ? { ...ext, enabled } : ext,
      ),
    }));
    void browser.runtime
      .sendMessage({ type: MESSAGE.EXTENSIONS_TOGGLE, id, enabled })
      .catch(() => {});
  }, []);

  const remove = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      extensions: current.extensions.filter((ext) => ext.id !== id),
    }));
    void browser.runtime
      .sendMessage({ type: MESSAGE.EXTENSIONS_DELETE, id })
      .catch(() => {});
  }, []);

  return { state, toggle, remove };
}

/**
 * The proactive repair ask, tab-local: the background targets exactly the
 * tab whose page just broke an extension's self-check (once per broken
 * version). The shell renders it as a RepairToast; `clear` dismisses.
 */
export function useRepairAsk(): {
  ask: { extension: SiteExtension; reason: string } | null;
  clear: () => void;
} {
  const [ask, setAsk] = useState<{
    extension: SiteExtension;
    reason: string;
  } | null>(null);

  useEffect(() => {
    const onMessage = (message: WebButlerMessage) => {
      if (message?.type !== MESSAGE.EXTENSION_BROKE) return;
      setAsk({ extension: message.extension, reason: message.reason });
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const clear = useCallback(() => setAsk(null), []);
  return { ask, clear };
}

/**
 * The session's artifacts (reports, drafts…), newest first — global state
 * like tasks: identical in every tab, refreshed by background broadcast.
 */
export function useArtifacts(): Report[] {
  const [artifacts, setArtifacts] = useState<Report[]>([]);

  useEffect(() => {
    let mounted = true;
    void browser.runtime
      .sendMessage({ type: MESSAGE.REPORTS_GET })
      .then((stored: Report[] | undefined) => {
        if (mounted && stored) setArtifacts(stored);
      })
      .catch(() => {});

    const onMessage = (message: WebButlerMessage) => {
      if (message?.type === MESSAGE.REPORTS_CHANGED) {
        setArtifacts(message.reports);
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  return artifacts;
}
