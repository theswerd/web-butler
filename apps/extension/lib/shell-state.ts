import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SHELL_PERSIST,
  MESSAGE,
  type ShellPersist,
  type WebButlerMessage,
} from '@web-butler/ui/shell';

/**
 * Shell state (open/collapsed, draft text, menu).
 *
 * Lives in the background under `chrome.storage.session` — so it survives
 * content-script remounts on reload/navigation. Draft/menu are keyed by tab
 * id (each tab keeps its own); `mode` is session-wide: closing the butler in
 * one tab closes it everywhere, and the background broadcasts flips from
 * other tabs via SHELL_MODE_CHANGED so live shells follow along.
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

  // Another tab flipped the shared mode — apply it locally, WITHOUT echoing
  // a SHELL_PATCH back (the background already persisted it; echoing would
  // re-broadcast in a loop).
  useEffect(() => {
    const onMessage = (message: WebButlerMessage) => {
      if (message?.type !== MESSAGE.SHELL_MODE_CHANGED) return;
      setState((current) =>
        current && current.mode !== message.mode
          ? { ...current, mode: message.mode }
          : current,
      );
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
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
