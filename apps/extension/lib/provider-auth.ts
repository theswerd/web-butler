import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { browser } from 'wxt/browser';
import type { ProviderAuth } from '@web-butler/ui/shell';

/**
 * Device-code auth state for one provider (Codex, Grok, …), owned by the
 * content-script shell and driven through the background:
 *
 * - lazily fetches the real status the first time `active` turns true
 * - `connect()` starts (or restarts) the device flow
 * - while `pending`, polls until the VM notices the browser-side sign-in
 *
 * The setter is exposed for out-of-band updates (e.g. RUN_START rejections
 * carry a fresh auth state the shell should adopt).
 */
export function useProviderAuth(
  startMessage: string,
  statusMessage: string,
  active: boolean,
): [ProviderAuth, () => void, Dispatch<SetStateAction<ProviderAuth>>] {
  const [auth, setAuth] = useState<ProviderAuth>({ status: 'unknown' });

  const connect = useCallback(() => {
    setAuth({ status: 'starting' });
    void browser.runtime
      .sendMessage({ type: startMessage })
      .then(
        (next: ProviderAuth) => setAuth(next),
        () => setAuth({ status: 'failed', error: 'Server unreachable' }),
      );
  }, [startMessage]);

  // Fetch the real state the first time it's needed.
  useEffect(() => {
    if (!active || auth.status !== 'unknown') return;
    let cancelled = false;
    void browser.runtime
      .sendMessage({ type: statusMessage })
      .then((next: ProviderAuth) => {
        if (cancelled || !next) return;
        // The fetch can resolve slowly (cold VM); never clobber a state
        // that a Connect click has moved along in the meantime.
        setAuth((current) => (current.status === 'unknown' ? next : current));
      })
      .catch(() => {
        // 'unknown' renders as a loading state — a dead fetch must not
        // leave the row checking forever, so degrade to a retryable fail.
        if (cancelled) return;
        setAuth((current) =>
          current.status === 'unknown'
            ? { status: 'failed', error: 'Server unreachable' }
            : current,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [active, auth.status, statusMessage]);

  // While a device login is pending, poll until it resolves — the CLI on
  // the VM notices the browser-side sign-in on its own.
  useEffect(() => {
    if (auth.status !== 'pending') return;
    const interval = window.setInterval(() => {
      void browser.runtime
        .sendMessage({ type: statusMessage })
        .then((next: ProviderAuth) => {
          if (!next) return;
          setAuth((current) => {
            if (current.status !== 'pending') return current;
            // Keep showing the code while still pending.
            return next.status === 'pending'
              ? {
                  ...next,
                  userCode: next.userCode ?? current.userCode,
                  verificationUrl:
                    next.verificationUrl ?? current.verificationUrl,
                  expiresAt: next.expiresAt ?? current.expiresAt,
                }
              : next;
          });
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(interval);
  }, [auth.status, statusMessage]);

  return [auth, connect, setAuth];
}
