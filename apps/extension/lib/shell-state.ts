import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SHELL_PERSIST,
  MESSAGE,
  type ShellPersist,
} from '@web-butler/ui/shell';

/**
 * Tab-scoped shell state (open/collapsed, draft text, menu).
 *
 * Lives in the background under `chrome.storage.session`, keyed by tab id —
 * so it survives content-script remounts on reload/navigation, but each tab
 * keeps its own copy. Cleared when the tab closes or the browser session ends.
 */
export function useShellPersist(): [
  ShellPersist | null,
  (patch: Partial<ShellPersist>) => void,
] {
  const [state, setState] = useState<ShellPersist | null>(null);

  useEffect(() => {
    let mounted = true;
    void browser.runtime
      .sendMessage({ type: MESSAGE.SHELL_GET })
      .then((stored: ShellPersist | undefined) => {
        if (!mounted) return;
        setState({ ...DEFAULT_SHELL_PERSIST, ...stored });
      })
      .catch(() => {
        // Background unavailable (rare) — fall back to defaults so the UI
        // still mounts instead of hanging on a blank screen.
        if (mounted) setState(DEFAULT_SHELL_PERSIST);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const patch = useCallback((partial: Partial<ShellPersist>) => {
    setState((current) => {
      if (!current) return current;
      return { ...current, ...partial };
    });
    void browser.runtime
      .sendMessage({ type: MESSAGE.SHELL_PATCH, patch: partial })
      .catch(() => {
        // Best-effort persist — local optimistic state already updated.
      });
  }, []);

  return [state, patch];
}
