import { useEffect, useState } from 'react';

export type ShellPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type ThemePref = 'light' | 'dark' | 'system';

export type AccentColor = 'blue' | 'violet' | 'rose' | 'amber' | 'emerald' | 'cyan';

export const ACCENT_OPTIONS: Array<{
  id: AccentColor;
  label: string;
  value: string;
}> = [
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'violet', label: 'Violet', value: '#8b5cf6' },
  { id: 'rose', label: 'Rose', value: '#f43f5e' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'emerald', label: 'Emerald', value: '#10b981' },
  { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
];

/** Providers that can run tasks; one is the active one. */
export type ActiveProvider = 'codex' | 'grok' | 'claude';

export type Settings = {
  position: ShellPosition;
  theme: ThemePref;
  accent: AccentColor;
  /** Which connected provider runs tasks. */
  provider: ActiveProvider;
  /** Combo strings like 'meta+e' / 'escape' (lowercase, '+'-joined). */
  hotkeyPrimary: string;
  hotkeyClose: string;
  /** Hostname patterns; matches the host and its subdomains. */
  excludedSites: string[];
  /** Freestyle API key — empty means "provided by the platform". */
  freestyleApiKey: string;
  /** Menu sidebar width (px) — user-draggable via the divider. */
  menuSidebarWidth: number;
};

export const DEFAULT_SETTINGS: Settings = {
  position: 'bottom-right',
  theme: 'system',
  accent: 'blue',
  provider: 'codex',
  hotkeyPrimary: 'meta+e',
  hotkeyClose: 'escape',
  excludedSites: [],
  freestyleApiKey: '',
  menuSidebarWidth: 148,
};

/**
 * True while a hotkey field is capturing a combo — the shell's global
 * keydown handler stands down so the pressed keys don't trigger actions.
 *
 * `onCombo` lets combos that never reach the page as keydowns still be
 * recorded: the extension's own command shortcut (default ⌘E) is consumed
 * by Chrome and arrives as a background command instead — the shell routes
 * it here while recording.
 */
export const hotkeyRecording: {
  active: boolean;
  onCombo: ((combo: string) => void) | null;
} = { active: false, onCombo: null };

/** The combo Chrome has bound to our toggle command on this platform. */
export const COMMAND_COMBO = /mac/i.test(navigator.platform)
  ? 'meta+e'
  : 'ctrl+e';

/** Resolves the Theme setting to an effective dark flag, tracking the OS
 *  preference live while in 'system' mode. */
export function useIsDark(theme: ThemePref): boolean {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return theme === 'dark' || (theme === 'system' && systemDark);
}

// --- Hotkey helpers ---------------------------------------------------------

const MODIFIER_KEYS = new Set(['meta', 'control', 'ctrl', 'alt', 'shift']);

/** Builds a combo string from a keydown, or null if only modifiers are down. */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push('meta');
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

export function comboMatches(combo: string, event: KeyboardEvent): boolean {
  return comboFromEvent(event) === combo;
}

const KEY_LABELS: Record<string, string> = {
  capslock: '⇪',
  escape: 'Esc',
  space: 'Space',
  enter: '↵',
  backspace: '⌫',
  tab: '⇥',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

const MODIFIER_LABELS: Record<string, string> = {
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};

/** 'meta+e' → '⌘E', 'escape' → 'Esc' */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      if (MODIFIER_LABELS[part]) return MODIFIER_LABELS[part];
      if (KEY_LABELS[part]) return KEY_LABELS[part];
      return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join('');
}

// --- Excluded sites ---------------------------------------------------------

/** Normalizes user input ('https://x.com/path', 'www.x.com') to a hostname. */
export function normalizeSitePattern(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  value = value.split(/[/?#:]/)[0];
  return value.includes('.') ? value : null;
}

export function isExcluded(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return patterns.some(
    (pattern) => host === pattern || host.endsWith(`.${pattern}`),
  );
}
