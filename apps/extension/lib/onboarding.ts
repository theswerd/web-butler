import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { MESSAGE, type ExtensionsState } from '@web-butler/ui/shell';

/**
 * First-run onboarding flag. `pending` until the user connects an AI
 * through the onboarding card — there's no skipping — then terminally
 * `done`. Providers in the menu stays available for changes afterward.
 */
const onboardingDoneItem = storage.defineItem<boolean>(
  'local:onboardingDone',
  { fallback: false },
);

export type OnboardingState = 'unknown' | 'pending' | 'done';

export function useOnboarding(): [OnboardingState, () => void] {
  const [state, setState] = useState<OnboardingState>('unknown');

  useEffect(() => {
    let cancelled = false;
    void onboardingDoneItem.getValue().then((done) => {
      if (!cancelled) setState(done ? 'done' : 'pending');
    });
    // Watching keeps every tab in sync — finishing (or skipping) once
    // swaps all open tabs back to the prompt.
    const unwatch = onboardingDoneItem.watch((done) =>
      setState(done ? 'done' : 'pending'),
    );
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  const markDone = useCallback(() => {
    setState('done');
    void onboardingDoneItem.setValue(true);
  }, []);

  return [state, markDone];
}

/**
 * Chrome's "Allow User Scripts" toggle, polled live while `active` (the
 * onboarding permissions step watches it and advances the moment the user
 * flips it — there's no event for it, so polling is the only signal).
 * `undefined` until the first answer arrives; detection itself happens in
 * the background, where the chrome.userScripts feature-check lives.
 */
export function useUserScriptsEnabled(active: boolean): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const check = () =>
      browser.runtime
        .sendMessage({ type: MESSAGE.EXTENSIONS_GET })
        .then((state: ExtensionsState | undefined) => {
          if (!cancelled && state) setEnabled(state.userScriptsAvailable);
        })
        .catch(() => {});
    void check();
    const interval = window.setInterval(check, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  return enabled;
}
