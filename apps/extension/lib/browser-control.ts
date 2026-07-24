/**
 * Browser control on the extension side: performing the agent's actions in
 * a real tab with browser.debugger (CDP), fronted by a visible "ghost
 * cursor" so it reads as a person doing the work.
 *
 * The server relays one BrowserAction at a time (see browser-tool.ts). Each
 * one:
 *   - snapshot: tags every interactive element with a `data-wb-ref` and
 *     returns a ref → role/name/value map the agent addresses elements by.
 *   - click / type: re-resolve the ref's live position, glide the ghost
 *     cursor there, THEN fire the real CDP input at those coordinates.
 *   - navigate / key / scroll: the obvious CDP calls.
 *
 * The cursor is purely visual (a message to the content script); the actual
 * input is dispatched by the debugger at the same coordinates a beat later,
 * which is what sells "the butler moved the mouse".
 */

import { browser } from 'wxt/browser';
import type {
  BrowserAction,
  BrowserActionResult,
  CursorCommand,
} from '@web-butler/ui/shell';

const PROTOCOL = '1.3';

/** Beats that make the motion legible: glide, then settle, then act. */
const MOVE_MS = 480;
const SETTLE_MS = 140;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tabs we hold a debugger session on, so we attach exactly once. */
const attached = new Set<number>();

browser.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attached.delete(source.tabId);
    netByTab.delete(source.tabId);
  }
});

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await browser.debugger.attach({ tabId }, PROTOCOL);
  attached.add(tabId);
  // Start sniffing traffic for the investigation feature (browser network).
  // Best-effort: input/DOM actions must still work if this fails.
  netByTab.set(tabId, { records: new Map(), order: [], nextSeq: 1 });
  try {
    await send(tabId, 'Network.enable', {
      maxTotalBufferSize: 10_000_000,
      maxResourceBufferSize: 5_000_000,
    });
  } catch {
    /* traffic capture just won't be available on this tab */
  }
}

/** Detach when a run is done so Chrome drops the "being debugged" banner. */
export async function detachTab(tabId: number): Promise<void> {
  netByTab.delete(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await browser.debugger.detach({ tabId });
  } catch {
    /* tab already gone */
  }
}

// ---------------------------------------------------------------------------
// Network sniffing. While attached we mirror the tab's requests into a small
// ring buffer, capturing XHR/fetch response bodies as they finish (they get
// evicted from CDP quickly, so we grab them eagerly). `browser network`
// dumps this — the agent's way to learn the API a page speaks.
// ---------------------------------------------------------------------------

type NetRecord = {
  /** Stable per-tab number the agent addresses this record by
      (`browser network <#seq>`), assigned on capture. */
  seq: number;
  url: string;
  method: string;
  type?: string; // CDP resourceType: XHR, Fetch, Document, Script…
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
};

type NetBuffer = {
  records: Map<string, NetRecord>;
  order: string[];
  nextSeq: number;
};

const netByTab = new Map<number, NetBuffer>();

/** How many requests we keep per tab, and how much of each body we store.
    The list view previews a slice; `network <#id>` shows the full store. */
const NET_MAX_RECORDS = 200;
const NET_BODY_STORE = 16_000;

/** Header values clipped so one bloated cookie can't drown the detail
    view; keys are kept verbatim. */
function clipHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (headers == null || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[key] = String(value).slice(0, 400);
  }
  return out;
}

function netPush(
  tabId: number,
  requestId: string,
  record: Omit<NetRecord, 'seq'>,
): void {
  const buf = netByTab.get(tabId);
  if (!buf) return;
  buf.records.set(requestId, { ...record, seq: buf.nextSeq++ });
  buf.order.push(requestId);
  while (buf.order.length > NET_MAX_RECORDS) {
    const evicted = buf.order.shift();
    if (evicted) buf.records.delete(evicted);
  }
}

browser.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId == null || !netByTab.has(tabId)) return;
  const p = (params ?? {}) as Record<string, any>;

  if (method === 'Network.requestWillBeSent') {
    const request = p.request ?? {};
    netPush(tabId, String(p.requestId), {
      url: String(request.url ?? ''),
      method: String(request.method ?? 'GET'),
      type: p.type,
      requestHeaders: clipHeaders(request.headers),
      requestBody:
        typeof request.postData === 'string'
          ? request.postData.slice(0, NET_BODY_STORE)
          : undefined,
    });
    return;
  }

  const buf = netByTab.get(tabId);
  const record = buf?.records.get(String(p.requestId));
  if (!record) return;

  if (method === 'Network.responseReceived') {
    const response = p.response ?? {};
    record.status = response.status;
    record.mimeType = response.mimeType;
    record.responseHeaders = clipHeaders(response.headers);
    if (p.type) record.type = p.type;
    return;
  }

  if (method === 'Network.loadingFinished') {
    // Only XHR/fetch bodies are worth the extra round-trip; page assets
    // aren't what the agent is investigating.
    if (record.type !== 'XHR' && record.type !== 'Fetch') return;
    void send<{ body?: string; base64Encoded?: boolean }>(
      tabId,
      'Network.getResponseBody',
      { requestId: String(p.requestId) },
    )
      .then((res) => {
        if (!res || typeof res.body !== 'string') return;
        if (!res.base64Encoded) {
          record.responseBody = res.body.slice(0, NET_BODY_STORE);
        } else if (/json|text|xml|javascript|urlencoded/i.test(record.mimeType ?? '')) {
          // Some texty responses arrive base64ed (e.g. gzip already
          // undone but flagged); decode rather than dropping them.
          try {
            record.responseBody = atob(res.body).slice(0, NET_BODY_STORE);
          } catch {
            /* not actually text — skip */
          }
        }
      })
      .catch(() => {
        /* body already gone / not text — skip it */
      });
  }
});

async function send<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return (await browser.debugger.sendCommand({ tabId }, method, params)) as T;
}

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
  const res = await send<{
    result?: { value?: T };
    exceptionDetails?: { text?: string };
  }>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || 'page evaluation failed');
  }
  return res.result?.value as T;
}

// ---------------------------------------------------------------------------
// Page-side scripts, kept as strings on purpose: passing a function through
// the bundler injects a `__name` helper that isn't defined in the page's
// world (learned the hard way in the prelude checks).
// ---------------------------------------------------------------------------

/** Tag every visible interactive element with a ref; return the ref map.
    Exported for the injected-script syntax/behavior check in scripts/. */
export const SNAPSHOT_JS = `(() => {
  const SEL = 'a[href], button, input, select, textarea, summary, ' +
    '[role=button], [role=link], [role=checkbox], [role=radio], [role=tab], ' +
    '[role=menuitem], [role=switch], [role=textbox], [contenteditable=""], ' +
    '[contenteditable=true], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll('[data-wb-ref]')) {
    el.removeAttribute('data-wb-ref');
  }
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (el.disabled) continue;
    // On-screen (with a little slack) — off-screen refs aren't clickable.
    if (r.bottom < -50 || r.top > innerHeight + 50) continue;
    const ref = 'e' + (++n);
    el.setAttribute('data-wb-ref', ref);
    const tag = el.tagName.toLowerCase();
    let role = el.getAttribute('role') || tag;
    if (tag === 'input') role = (el.getAttribute('type') || 'text');
    const name = (
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute('placeholder') ||
      (el.innerText || '').trim() ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('name') ||
      ''
    ).replace(/\\s+/g, ' ').trim().slice(0, 80);
    let value = '';
    if ('value' in el && typeof el.value === 'string') value = el.value.slice(0, 60);
    out.push({ ref, role, name, value });
  }
  return out;
})()`;

/** Live viewport-center of one ref (scrolled into view first), or null. */
function locateJs(ref: string): string {
  const sel = JSON.stringify(`[data-wb-ref="${ref}"]`);
  return `(() => {
    const el = document.querySelector(${sel});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
             label: (el.getAttribute('aria-label') || (el.innerText||'').trim() ||
                     el.getAttribute('placeholder') || '').replace(/\\s+/g,' ').slice(0, 40) };
  })()`;
}

/** Pick a <select>'s option by label/value; native dropdown popups are OS
    chrome, so the value is set directly and the page's handlers fired.
    Exported for the injected-script behavior check in scripts/. */
export function selectOptionJs(ref: string, option: string): string {
  const sel = JSON.stringify(`[data-wb-ref="${ref}"]`);
  const want = JSON.stringify(option);
  return `(() => {
    const el = document.querySelector(${sel});
    if (!el || el.tagName !== 'SELECT') return { ok: false, notSelect: true };
    const want = ${want}.trim().toLowerCase();
    const opts = Array.from(el.options);
    const label = (o) => (o.label || o.textContent || '').replace(/\\s+/g, ' ').trim();
    const hit =
      opts.find((o) => label(o).toLowerCase() === want) ||
      opts.find((o) => (o.value || '').toLowerCase() === want) ||
      opts.find((o) => label(o).toLowerCase().includes(want));
    if (!hit) return { ok: false, options: opts.slice(0, 30).map(label) };
    el.value = hit.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, picked: label(hit) };
  })()`;
}

/** Focus a field and select its contents so typed text replaces them. */
function focusAndSelectJs(ref: string): string {
  const sel = JSON.stringify(`[data-wb-ref="${ref}"]`);
  return `(() => {
    const el = document.querySelector(${sel});
    if (!el) return false;
    el.focus();
    try { if (el.select) el.select();
      else if (el.setSelectionRange) el.setSelectionRange(0, (el.value||'').length);
      else document.execCommand && document.getSelection &&
        (getSelection().selectAllChildren(el)); } catch {}
    return true;
  })()`;
}

type Located = { x: number; y: number; label: string } | null;

/** "example.com" for the navigate status pill; falls back to the raw URL
    clipped so a bad string still reads. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url.slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
}

// ---------------------------------------------------------------------------
// The action executor.
// ---------------------------------------------------------------------------

/** Emits ghost-cursor steps to the content script in the target tab. */
export type CursorRelay = (cursor: CursorCommand) => void;

/**
 * Perform one browser action in `tabId`, animating the ghost cursor via
 * `relay`. `tabs` is handled by the caller (needs chrome.tabs, not the
 * debugger); everything else lands here.
 */
export async function performAction(
  tabId: number,
  action: BrowserAction,
  relay: CursorRelay,
): Promise<BrowserActionResult> {
  await ensureAttached(tabId);

  // Every action announces itself on the page — cursor motion for the
  // pointer verbs, the status pill for everything that would otherwise be
  // invisible. The butler never works covertly in a tab the user is watching.
  switch (action.kind) {
    case 'snapshot': {
      relay({ kind: 'status', text: 'Mapping this page' });
      const els = await evaluate<
        Array<{ ref: string; role: string; name: string; value: string }>
      >(tabId, SNAPSHOT_JS);
      return { ok: true, data: formatSnapshot(els) };
    }

    case 'read': {
      relay({ kind: 'status', text: 'Reading this page' });
      const text = await evaluate<string>(
        tabId,
        `((document.body && document.body.innerText) || '')
           .replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 8000)`,
      );
      return { ok: true, data: text || '(no visible text on this page)' };
    }

    case 'navigate': {
      relay({ kind: 'status', text: `Opening ${hostOf(action.url)}` });
      await send(tabId, 'Page.navigate', { url: action.url });
      await sleep(600); // let the commit happen before the next snapshot
      return { ok: true, data: `navigated to ${action.url}` };
    }

    case 'back': {
      relay({ kind: 'status', text: 'Going back' });
      await evaluate(tabId, 'history.back()');
      await sleep(600);
      return { ok: true, data: 'went back one page' };
    }

    case 'network': {
      // Make the invisible visible: the user sees that traffic was reviewed.
      relay({ kind: 'status', text: 'Reviewing network traffic' });
      const buf = netByTab.get(tabId);
      return {
        ok: true,
        data:
          action.seq != null
            ? formatNetworkDetail(buf, action.seq)
            : formatNetwork(buf, action.filter),
      };
    }

    case 'screenshot': {
      // Capture FIRST — the flash is feedback, not something to photograph.
      const res = await send<{ data?: string }>(tabId, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 70,
      });
      if (!res?.data) {
        return { ok: false, error: 'could not capture the tab (is it visible?)' };
      }
      relay({ kind: 'flash' });
      return { ok: true, data: { screenshotBase64: res.data } };
    }

    case 'select': {
      const at = await evaluate<Located>(tabId, locateJs(action.ref));
      if (!at) {
        return { ok: false, error: `no element for ref ${action.ref} (re-snapshot)` };
      }
      await glide(relay, at.x, at.y, at.label);
      const picked = await evaluate<{
        ok: boolean;
        picked?: string;
        options?: string[];
        notSelect?: boolean;
      }>(tabId, selectOptionJs(action.ref, action.option));
      relay({ kind: 'hide' });
      if (!picked?.ok) {
        if (picked?.notSelect) {
          return {
            ok: false,
            error: `${action.ref} is not a <select> — for custom dropdowns, click it open and click the option`,
          };
        }
        const options = picked?.options?.length
          ? ` Available options: ${picked.options.join(' | ')}`
          : '';
        return {
          ok: false,
          error: `no option matching ${JSON.stringify(action.option)} in ${action.ref}.${options}`,
        };
      }
      return { ok: true, data: `selected "${picked.picked}" in ${action.ref}` };
    }

    case 'click': {
      const at = await evaluate<Located>(tabId, locateJs(action.ref));
      if (!at) {
        return { ok: false, error: `no element for ref ${action.ref} (re-snapshot)` };
      }
      await glide(relay, at.x, at.y, at.label);
      await clickAt(tabId, at.x, at.y);
      relay({ kind: 'hide' });
      return { ok: true, data: `clicked ${action.ref}` };
    }

    case 'type': {
      const at = await evaluate<Located>(tabId, locateJs(action.ref));
      if (!at) {
        return { ok: false, error: `no element for ref ${action.ref} (re-snapshot)` };
      }
      await glide(relay, at.x, at.y, at.label);
      await clickAt(tabId, at.x, at.y);
      const focused = await evaluate<boolean>(tabId, focusAndSelectJs(action.ref));
      if (!focused) {
        return { ok: false, error: `could not focus ref ${action.ref}` };
      }
      relay({ kind: 'type', x: at.x, y: at.y });
      // insertText replaces the selection made above, so re-typing a field
      // overwrites instead of appending.
      await send(tabId, 'Input.insertText', { text: action.text });
      if (action.submit) await pressKey(tabId, 'Enter');
      relay({ kind: 'hide' });
      return { ok: true, data: `typed into ${action.ref}` };
    }

    case 'key': {
      relay({ kind: 'status', text: `Pressing ${action.key}` });
      await pressKey(tabId, action.key);
      return { ok: true, data: `pressed ${action.key}` };
    }

    case 'scroll': {
      await evaluate(
        tabId,
        `window.scrollBy({ top: ${Number(action.dy) || 0}, behavior: 'smooth' })`,
      );
      await sleep(300);
      return { ok: true, data: `scrolled ${action.dy}px` };
    }

    default:
      return { ok: false, error: 'unknown action' };
  }
}

/** Glide the ghost cursor to a target and let it settle before acting. */
async function glide(
  relay: CursorRelay,
  x: number,
  y: number,
  label: string,
): Promise<void> {
  relay({ kind: 'move', x, y, label: label || undefined });
  await sleep(MOVE_MS);
  relay({ kind: 'press', x, y });
  await sleep(SETTLE_MS);
}

/** A real left click at viewport coordinates via CDP. */
async function clickAt(tabId: number, x: number, y: number): Promise<void> {
  const base = { x, y, button: 'left' as const, clickCount: 1 };
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(tabId, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mousePressed',
    buttons: 1,
  });
  await send(tabId, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseReleased',
    buttons: 1,
  });
}

/** CDP virtual-key metadata for named keys, looked up case-insensitively. */
const KEYS: Record<
  string,
  { key: string; code: string; keyCode: number; text?: string }
> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  win: 4,
  shift: 8,
};

/** Exported for the key-combo parsing check in scripts/. */
export function resolveKey(
  name: string,
): { key: string; code: string; keyCode: number; text?: string } | null {
  const named = KEYS[name.toLowerCase()];
  if (named) return named;
  // Single printable character: "a", "/", "1" — enough for shortcuts
  // like Ctrl+A or a bare "?" help key.
  if ([...name].length === 1) {
    const upper = name.toUpperCase();
    const code = /^[a-z]$/i.test(name)
      ? `Key${upper}`
      : /^[0-9]$/.test(name)
        ? `Digit${name}`
        : '';
    return { key: name, code, keyCode: upper.charCodeAt(0), text: name };
  }
  return null;
}

/** Press a key or a modifier combo ("Enter", "Ctrl+A", "Shift+Tab"). */
async function pressKey(tabId: number, spec: string): Promise<void> {
  const parts = spec.split('+').map((part) => part.trim()).filter(Boolean);
  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    const bit = MODIFIER_BITS[part.toLowerCase()];
    if (bit == null) throw new Error(`unsupported modifier: ${part}`);
    modifiers |= bit;
  }
  const k = parts.length > 0 ? resolveKey(parts[parts.length - 1]) : null;
  if (!k) throw new Error(`unsupported key: ${spec}`);
  // Held Ctrl/Alt/Meta means a shortcut, not text entry.
  const text = modifiers & (1 | 2 | 4) ? undefined : k.text;
  const base = {
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
    modifiers,
  };
  await send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyDown', text });
  await send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

/** How much of each stored body to actually show the agent per call. */
const NET_BODY_SHOW = 1200;

/**
 * The captured traffic as the agent reads it. Default view is XHR/fetch —
 * the API calls behind a page. `filter` narrows by URL substring, or "all"
 * widens to every request type (assets included).
 */
function formatNetwork(buf: NetBuffer | undefined, filter?: string): string {
  if (!buf || buf.order.length === 0) {
    return 'No network traffic captured yet. Reload the page or trigger the action that makes the request (a search, a click), then run `browser network` again.';
  }
  const all = filter?.toLowerCase() === 'all';
  const needle = all ? '' : (filter ?? '').toLowerCase();
  const rows = buf.order
    .map((id) => buf.records.get(id))
    .filter((r): r is NetRecord => r != null)
    .filter((r) => all || r.type === 'XHR' || r.type === 'Fetch')
    .filter((r) => !needle || r.url.toLowerCase().includes(needle));

  if (rows.length === 0) {
    return needle
      ? `No requests matching "${filter}". Try \`browser network\` with no filter, or \`browser network all\`.`
      : 'No XHR/fetch calls captured. The page may render server-side, or use `browser network all` to see every request.';
  }

  // Newest last is how they happened; cap so a chatty page stays readable.
  const shown = rows.slice(-40);
  const clip = (s: string) => (s.length > NET_BODY_SHOW ? `${s.slice(0, NET_BODY_SHOW)}…[truncated]` : s);
  const blocks = shown.map((r) => {
    const status = r.status != null ? String(r.status) : '...';
    const lines = [`#${r.seq} ${r.method} ${status}  ${r.url}`];
    if (r.requestBody) lines.push(`  → request: ${clip(r.requestBody)}`);
    if (r.responseBody) lines.push(`  ← response: ${clip(r.responseBody)}`);
    return lines.join('\n');
  });
  const header =
    `${rows.length} ${all ? 'requests' : 'XHR/fetch calls'} captured` +
    (shown.length < rows.length ? ` (showing the last ${shown.length})` : '') +
    ':';
  const footer =
    'Run `browser network <#id>` for one call in full (headers + complete bodies).';
  return `${header}\n${blocks.join('\n\n')}\n\n${footer}`;
}

/** One captured call in full: the deep-dive behind the list's previews. */
function formatNetworkDetail(buf: NetBuffer | undefined, seq: number): string {
  const record = buf
    ? [...buf.records.values()].find((r) => r.seq === seq)
    : undefined;
  if (!record) {
    return `No captured call #${seq} — it may have been evicted (only the last ${NET_MAX_RECORDS} are kept). Run \`browser network\` to list what's here.`;
  }
  const headerBlock = (headers?: Record<string, string>) =>
    headers && Object.keys(headers).length > 0
      ? Object.entries(headers)
          .map(([key, value]) => `  ${key}: ${value}`)
          .join('\n')
      : '  (none captured)';
  const body = (text?: string) =>
    text
      ? text.length >= NET_BODY_STORE
        ? `${text}\n  …[stored body ends here — first ${NET_BODY_STORE} chars]`
        : text
      : '  (empty or not captured)';
  const status = record.status != null ? String(record.status) : '...';
  return [
    `#${record.seq} ${record.method} ${status}  ${record.url}`,
    `type: ${record.type ?? 'unknown'}${record.mimeType ? ` · mime: ${record.mimeType}` : ''}`,
    '',
    'request headers:',
    headerBlock(record.requestHeaders),
    '',
    'request body:',
    body(record.requestBody),
    '',
    'response headers:',
    headerBlock(record.responseHeaders),
    '',
    'response body:',
    body(record.responseBody),
  ].join('\n');
}

/** The ref map as the agent reads it: one element per line, aligned. */
function formatSnapshot(
  els: Array<{ ref: string; role: string; name: string; value: string }>,
): string {
  if (!els || els.length === 0) {
    return 'No interactive elements found on the visible page. Try scrolling, or the page may still be loading.';
  }
  const lines = els.map((el) => {
    const name = el.name ? ` "${el.name}"` : '';
    const value = el.value ? `  = ${JSON.stringify(el.value)}` : '';
    return `${el.ref}\t${el.role}${name}${value}`;
  });
  return (
    `${els.length} interactive elements (address them by ref):\n` +
    lines.join('\n')
  );
}
