import { useCallback, useEffect, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import { DEFAULT_SETTINGS, type Settings } from '@web-butler/ui';

/**
 * Extension-side persistence for the shared Settings shape. Lives here (not
 * in @web-butler/ui) because it depends on `wxt/utils/storage`, which only
 * exists inside an extension context — Storybook renders the same components
 * with plain useState instead.
 */
const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let mounted = true;
    void settingsItem.getValue().then((stored) => {
      // Merge so settings added in later versions pick up their defaults.
      if (mounted) setSettings({ ...DEFAULT_SETTINGS, ...stored });
    });
    const unwatch = settingsItem.watch((stored) => {
      setSettings({ ...DEFAULT_SETTINGS, ...stored });
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      void settingsItem.setValue(next);
      return next;
    });
  }, []);

  return [settings, update];
}
