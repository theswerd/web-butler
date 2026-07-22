import type { SiteExtension } from '@web-butler/ui/shell';

/**
 * Site-extension injection via chrome.userScripts: the background mirrors
 * the enabled extensions into user-script registrations (arbitrary code
 * strings, which MV3 forbids everywhere else), so matching pages get them
 * on every load. Each registration is the runtime prelude + the agent's
 * script; the prelude provides the `webButler.register` / `page` helper
 * contract the authoring skill promises (see the server's
 * extension-skill.ts) and tracks everything so disable can revert live.
 *
 * Chrome gates the API behind the user's "Allow User Scripts" toggle
 * (dev mode pre-138): every entry point feature-checks and no-ops when
 * it's off — extensions still sync and list, they just don't inject.
 */

// The userScripts surface we use, typed by hand: @types/chrome trails the
// API (`execute` is 135+) and WXT's browser facade doesn't cover it.
type UserScriptDef = { code: string };
type RegisteredUserScript = {
  id: string;
  matches: string[];
  js: UserScriptDef[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  world?: 'USER_SCRIPT' | 'MAIN';
};
type UserScriptsApi = {
  register(scripts: RegisteredUserScript[]): Promise<void>;
  unregister(filter?: { ids?: string[] }): Promise<void>;
  getScripts(filter?: { ids?: string[] }): Promise<RegisteredUserScript[]>;
  /** World config — `messaging: true` lets scripts sendMessage back to us
      (delivered on chrome.runtime.onUserScriptMessage). */
  configureWorld?(config: { messaging?: boolean }): Promise<void>;
  /** Chrome 135+ — one-off injection into an open tab. */
  execute?(injection: {
    target: { tabId: number };
    js: UserScriptDef[];
    world?: 'USER_SCRIPT' | 'MAIN';
    injectImmediately?: boolean;
  }): Promise<unknown>;
};

function userScriptsApi(): UserScriptsApi | null {
  try {
    // Property access itself throws while the user toggle is off.
    const api = (globalThis as { chrome?: { userScripts?: UserScriptsApi } })
      .chrome?.userScripts;
    if (!api) return null;
    void api.getScripts; // the documented feature-check
    return api;
  } catch {
    return null;
  }
}

/** False = Chrome won't inject (toggle off / unsupported browser). */
export function userScriptsAvailable(): boolean {
  return userScriptsApi() !== null;
}

/**
 * The per-extension wrapper around the agent's script. One shared runtime
 * per page (registry, revert logic, SPA re-apply via history patching);
 * per-script `page` helpers bound to the extension's id so everything a
 * script adds is tagged and revertible without trusting its `remove`.
 * Exported for scripts/extension-prelude-check.ts.
 */
export function buildCode(ext: SiteExtension): string {
  return `(() => {
  // ${ext.name} v${ext.version} — Web Butler site extension
  const __id = ${JSON.stringify(ext.id)};
  const __version = ${ext.version};
  const __g = globalThis;
  if (!__g.__webButlerRuntime) {
    const runtime = {
      regs: new Map(),
      navCallbacks: [],
      // Self-diagnosis → background. Requires the world's messaging flag
      // (configureWorld in the background); silently drops otherwise.
      report(id, version, status, reason) {
        try {
          chrome.runtime.sendMessage({
            webButlerHealth: {
              id, version, status,
              reason: reason ? String(reason).slice(0, 500) : undefined,
              url: location.href,
            },
          }).catch(() => {});
        } catch (e) {}
      },
      // Run one extension's apply and then diagnose it: a thrown apply is
      // broken outright; otherwise its own check(page) gets the verdict.
      // The check waits out lazy rendering before calling anything broken.
      run(reg) {
        let applyError = null;
        try { reg.handlers.apply && reg.handlers.apply(reg.page); }
        catch (e) { applyError = e; console.warn('[web-butler]', e); }
        clearTimeout(reg.diagnoseTimer);
        if (applyError) {
          runtime.report(reg.id, reg.version, 'broken',
            applyError && applyError.message || applyError);
          return;
        }
        reg.diagnoseTimer = setTimeout(() => {
          if (!runtime.regs.has(reg.id)) return;
          let verdict = true;
          try { verdict = reg.handlers.check ? reg.handlers.check(reg.page) : true; }
          catch (e) { verdict = (e && e.message) || 'check() threw'; }
          if (verdict === true || verdict === undefined || verdict === null) {
            runtime.report(reg.id, reg.version, 'ok');
          } else {
            runtime.report(reg.id, reg.version, 'broken',
              typeof verdict === 'string' ? verdict : 'check() returned false');
          }
        }, 2000);
      },
      remove(id) {
        const reg = runtime.regs.get(id);
        runtime.regs.delete(id);
        try { reg && clearTimeout(reg.diagnoseTimer); } catch (e) {}
        try { reg && reg.handlers.remove && reg.handlers.remove(); } catch (e) {}
        runtime.navCallbacks = runtime.navCallbacks.filter((c) => c.id !== id);
        document.querySelectorAll('[data-web-butler-ext="' + id + '"]')
          .forEach((n) => n.remove());
        document.querySelectorAll('[data-web-butler-hidden="' + id + '"]')
          .forEach((n) => {
            n.style.removeProperty('display');
            n.removeAttribute('data-web-butler-hidden');
          });
      },
      applyAll() {
        for (const reg of runtime.regs.values()) runtime.run(reg);
        for (const cb of runtime.navCallbacks) {
          try { cb.fn(location.href); } catch (e) {}
        }
      },
    };
    // SPA navigations re-run apply (which the contract requires to be
    // idempotent). Patched once per page world.
    let href = location.href;
    const onChange = () => {
      if (location.href === href) return;
      href = location.href;
      setTimeout(() => runtime.applyAll(), 50);
    };
    const push = history.pushState.bind(history);
    history.pushState = function (...args) { push(...args); onChange(); };
    const replace = history.replaceState.bind(history);
    history.replaceState = function (...args) { replace(...args); onChange(); };
    addEventListener('popstate', onChange);
    __g.__webButlerRuntime = runtime;
  }
  const __runtime = __g.__webButlerRuntime;

  const page = {
    addStyle(css) {
      const style = document.createElement('style');
      style.setAttribute('data-web-butler-ext', __id);
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    },
    hide(el) {
      if (!el || el.getAttribute('data-web-butler-hidden')) return;
      el.setAttribute('data-web-butler-hidden', __id);
      el.style.setProperty('display', 'none', 'important');
    },
    mark(el) {
      if (el) el.setAttribute('data-web-butler-ext', __id);
      return el;
    },
    insert(html, anchor, position = 'beforeend') {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const el = tpl.content.firstElementChild;
      if (!el) return null;
      el.setAttribute('data-web-butler-ext', __id);
      const target = anchor || document.body || document.documentElement;
      if (position === 'beforeend') target.append(el);
      else if (position === 'afterbegin') target.prepend(el);
      else if (position === 'beforebegin') target.before(el);
      else target.after(el);
      return el;
    },
    onNavigate(fn) {
      __runtime.navCallbacks.push({ id: __id, fn });
    },
  };

  const webButler = {
    register(handlers) {
      // Re-execution (update/instant apply) replaces the previous copy.
      if (__runtime.regs.has(__id)) __runtime.remove(__id);
      const reg = { id: __id, version: __version, handlers, page, diagnoseTimer: 0 };
      __runtime.regs.set(__id, reg);
      __runtime.run(reg);
    },
  };

  ${ext.script}
})();`;
}

const SCRIPT_ID_PREFIX = 'web-butler-ext-';

/**
 * Mirror the extension list into Chrome's registrations, wholesale: ours
 * are unregistered and the enabled set re-registered. At this scale
 * (tens, not thousands) that's simpler and safer than diffing.
 *
 * Returns true when Chrome had NONE of our scripts but registrations were
 * just created. Chrome clears every registration when the user-scripts
 * switch goes off, so "empty → some" is the fingerprint of the switch
 * being (re-)enabled — the caller should then inject into open tabs too,
 * because registration alone only covers future page loads.
 */
export async function syncRegistrations(
  extensions: SiteExtension[],
): Promise<boolean> {
  const api = userScriptsApi();
  if (!api) return false;
  try {
    // Health reports ride sendMessage out of the USER_SCRIPT world, which
    // is off until the world is configured. Once per sync is cheap.
    await api.configureWorld?.({ messaging: true }).catch(() => {});
    const ours = (await api.getScripts())
      .map((script) => script.id)
      .filter((id) => id.startsWith(SCRIPT_ID_PREFIX));
    if (ours.length > 0) await api.unregister({ ids: ours });
    const enabled = extensions.filter((ext) => ext.enabled);
    if (enabled.length > 0) {
      await api.register(
        enabled.map((ext) => ({
          id: `${SCRIPT_ID_PREFIX}${ext.id}`,
          matches: ext.urlPatterns,
          runAt: ext.stage,
          world: 'USER_SCRIPT' as const,
          js: [{ code: buildCode(ext) }],
        })),
      );
    }
    return ours.length === 0 && enabled.length > 0;
  } catch (error) {
    console.warn('[web-butler] user script sync failed:', error);
    return false;
  }
}

/** Open tabs whose URL the extension's patterns cover. */
async function matchingTabs(ext: SiteExtension): Promise<number[]> {
  try {
    const tabs = await (
      globalThis as unknown as {
        chrome: {
          tabs: {
            query(info: { url: string[] }): Promise<Array<{ id?: number }>>;
          };
        };
      }
    ).chrome.tabs.query({ url: ext.urlPatterns });
    return tabs.map((tab) => tab.id).filter((id): id is number => id != null);
  } catch {
    return [];
  }
}

/**
 * Apply to already-open matching tabs, no reload needed (registration
 * only covers future loads). Re-execution replaces a previous version in
 * place. Chrome <135 lacks `execute`; those tabs pick it up on reload.
 */
export async function applyToOpenTabs(ext: SiteExtension): Promise<void> {
  const api = userScriptsApi();
  if (!api?.execute) return;
  const code = buildCode(ext);
  for (const tabId of await matchingTabs(ext)) {
    await api
      .execute({
        target: { tabId },
        world: 'USER_SCRIPT',
        js: [{ code }],
        injectImmediately: true,
      })
      .catch(() => {}); // tab gone / not injectable — reload covers it
  }
}

/**
 * Revert in already-open matching tabs (disable/delete): calls the
 * script's `remove` through the page runtime and sweeps tagged nodes.
 */
export async function removeFromOpenTabs(ext: SiteExtension): Promise<void> {
  const api = userScriptsApi();
  if (!api?.execute) return;
  const code = `globalThis.__webButlerRuntime && globalThis.__webButlerRuntime.remove(${JSON.stringify(ext.id)});`;
  for (const tabId of await matchingTabs(ext)) {
    await api
      .execute({ target: { tabId }, world: 'USER_SCRIPT', js: [{ code }] })
      .catch(() => {});
  }
}
