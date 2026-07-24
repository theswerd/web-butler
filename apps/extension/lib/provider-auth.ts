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

  // Fetch the real state the first time it's needed. 'unknown' renders as
  // a loading state ("Checking…"), so it must never be terminal: the
  // background answers 'unknown' whenever the server or sandbox isn't
  // reachable yet (it deliberately doesn't cache that), and a single
  // no-answer fetch used to park the row on Checking… forever. Retry with
  // backoff — dev servers and cold VMs come up in seconds — and if it
  // still can't answer, degrade to a retryable fail.
  useEffect(() => {
    if (!active || auth.status !== 'unknown') return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;

    const giveUp = () =>
      setAuth((current) =>
        current.status === 'unknown'
          ? { status: 'failed', error: 'Could not reach the server' }
          : current,
      );
    const settleOrRetry = (next: ProviderAuth | undefined) => {
      if (cancelled) return;
      if (next && next.status !== 'unknown') {
        // The fetch can resolve slowly (cold VM); never clobber a state
        // that a Connect click has moved along in the meantime.
        setAuth((current) => (current.status === 'unknown' ? next : current));
        return;
      }
      attempt += 1;
      if (attempt >= 5) {
        giveUp();
        return;
      }
      timer = window.setTimeout(fetchStatus, 2000 * attempt);
    };
    const fetchStatus = () => {
      void browser.runtime.sendMessage({ type: statusMessage }).then(
        (next: ProviderAuth) => settleOrRetry(next),
        // A rejected message (no background at all) retries the same way.
        () => settleOrRetry(undefined),
      );
    };
    fetchStatus();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
