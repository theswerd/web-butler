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
  if (source.tabId != null) attached.delete(source.tabId);
});

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await browser.debugger.attach({ tabId }, PROTOCOL);
  attached.add(tabId);
}

/** Detach when a run is done so Chrome drops the "being debugged" banner. */
export async function detachTab(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await browser.debugger.detach({ tabId });
  } catch {
    /* tab already gone */
  }
}

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

  switch (action.kind) {
    case 'snapshot': {
      const els = await evaluate<
        Array<{ ref: string; role: string; name: string; value: string }>
      >(tabId, SNAPSHOT_JS);
      return { ok: true, data: formatSnapshot(els) };
    }

    case 'navigate': {
      await send(tabId, 'Page.navigate', { url: action.url });
      await sleep(600); // let the commit happen before the next snapshot
      return { ok: true, data: `navigated to ${action.url}` };
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

/** CDP virtual-key metadata for the keys the agent actually presses. */
const KEYS: Record<
  string,
  { key: string; code: string; keyCode: number; text?: string }
> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};

async function pressKey(tabId: number, name: string): Promise<void> {
  const k = KEYS[name];
  if (!k) throw new Error(`unsupported key: ${name}`);
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
    text: k.text,
  });
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
  });
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
