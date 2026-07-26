/**
 * MAIN-world companion to the shell's keyboard absorption (content/index).
 *
 * The problem it solves: shadow retargeting makes events from inside the
 * shell reach the page with `<web-butler>` — not an input — as their
 * target. The isolated-world absorption stops key events from BUBBLING to
 * the page, but capture-phase listeners on window/document run BEFORE the
 * event ever descends into our shadow, and heavy players (Hulu piles
 * dozens of capture keydown listeners on window) treat anything that isn't
 * an input as theirs:
 *
 *  - keydowns get preventDefault'ed (killing text insertion) or routed
 *    into player shortcuts;
 *  - mousedowns on unrecognized targets get preventDefault'ed, which
 *    blocks the browser's focus-and-select default — clicks still "work"
 *    (click fires regardless) but the textbox never takes focus and text
 *    can't be selected;
 *  - focus managers yank focus back to the player the moment it lands
 *    anywhere they don't recognize.
 *
 * Running in the page's own world at document_start — before any page
 * script — this registers first-in-line capture listeners and counters
 * all three:
 *
 *  1. DISGUISE. Events aimed at the shell get their `target`/`srcElement`
 *     (and `relatedTarget` for focus moves) shadowed with a detached
 *     <input>, so the page's own "is the user typing?" guards pass and its
 *     shortcut/focus code skips them voluntarily. `preventDefault`/
 *     `stopPropagation`/`stopImmediatePropagation` become no-ops on the
 *     page's view of the event, so a site that mishandles it anyway can't
 *     cancel or halt it. Our own handlers live in the isolated world with
 *     their own event wrapper — its methods and target stay fully real.
 *     `document.activeElement` reports the same decoy while focus is in
 *     the shell.
 *
 *  2. KEYSTROKE BLOCKADE. While a shell TEXT FIELD is focused, printable
 *     keys and Backspace/Delete are hard-stopped (real
 *     stopImmediatePropagation) at the first capture listener: the page
 *     never sees them at all, guards or no guards. Text insertion is the
 *     browser's DEFAULT action — propagation stops don't cancel it — and
 *     no in-shell handler needs those keydowns (Enter/arrows/Tab do, so
 *     they're only disguised). Non-text-field focus (menu rows, the hotkey
 *     recorder) keeps full React keydown delivery.
 *
 *  3. FOCUS SHIELD. While the shell is "engaged" (focus already inside it,
 *     a pointerdown on it within the last moment, or a focus transition
 *     into it mid-flight), page-initiated `HTMLElement.focus()` calls on
 *     non-shell elements are dropped, so focus managers can't steal the
 *     caret back. Native focus moves (the user clicking or tabbing away)
 *     don't go through the JS method and always work.
 *
 * Page-originated events never target the shell host, so none of this
 * touches the site's normal behavior.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  registration: 'manifest',

  main() {
    const HOST = 'web-butler';
    const isHost = (node: unknown): node is Element =>
      node instanceof Element && node.localName === HOST;

    // Detached, so it can't collide with anything the page queries for.
    let decoy: HTMLInputElement | null = null;
    const getDecoy = () => (decoy ??= document.createElement('input'));
    const noop = () => {};
    // Saved before any per-event neutering: the blockade needs the real one.
    const realStop = Event.prototype.stopImmediatePropagation;

    const realActiveGet = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'activeElement',
    )?.get;
    const realActive = (): Element | null =>
      (realActiveGet?.call(document) as Element | null) ?? null;

    /** Rewrite the page's view of an event aimed at the shell (see 1.). */
    const disguise = (event: Event) => {
      const stand = getDecoy();
      for (const key of ['target', 'srcElement'] as const) {
        try {
          Object.defineProperty(event, key, {
            value: stand,
            configurable: true,
          });
        } catch {
          /* frozen event — nothing to do */
        }
      }
      event.preventDefault = noop;
      event.stopPropagation = noop;
      event.stopImmediatePropagation = noop;
    };

    // ---- 2. keyboard: disguise, or blockade for text-field typing ----

    const isTextField = (el: unknown): boolean =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement &&
        /^(?:text|search|url|email|password|number)$/.test(el.type));

    const keyGuard = (event: Event) => {
      const host = event.target;
      if (!isHost(host)) return;
      if (
        event.type === 'keydown' ||
        event.type === 'keypress' ||
        event.type === 'keyup'
      ) {
        const key = event as KeyboardEvent;
        const printable =
          key.key.length === 1 && !key.ctrlKey && !key.metaKey && !key.altKey;
        const editing = key.key === 'Backspace' || key.key === 'Delete';
        if (
          (printable || editing) &&
          isTextField(host.shadowRoot?.activeElement)
        ) {
          realStop.call(event);
          return;
        }
      }
      disguise(event);
    };
    for (const type of [
      'keydown',
      'keypress',
      'keyup',
      'beforeinput',
      'input', // React's onChange rides this — disguise only, never stop
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ] as const) {
      window.addEventListener(type, keyGuard, { capture: true });
    }

    // ---- 1b. pointer: clicking into the shell must focus it ----

    let shellPointerAt = 0;
    const pointerGuard = (event: Event) => {
      if (!isHost(event.target)) {
        // A pointerdown on the page hands focus authority back to it.
        if (event.type === 'pointerdown' || event.type === 'mousedown') {
          shellPointerAt = 0;
        }
        return;
      }
      if (event.type === 'pointerdown' || event.type === 'mousedown') {
        shellPointerAt = Date.now();
      }
      disguise(event);
    };
    for (const type of [
      'pointerdown',
      'pointerup',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'contextmenu',
      'selectstart',
    ] as const) {
      window.addEventListener(type, pointerGuard, { capture: true });
    }

    // ---- 3. focus shield ----

    let focusMoveUntil = 0;
    const shellEngaged = () =>
      isHost(realActive()) ||
      Date.now() < focusMoveUntil ||
      Date.now() - shellPointerAt < 800;

    const focusGuard = (event: Event) => {
      const targetsHost = isHost(event.target);
      const relatedIsHost = isHost((event as FocusEvent).relatedTarget);
      if (!targetsHost && !relatedIsHost) return;
      // A focus transition touching the shell is in flight. Mid-transition
      // the active element is momentarily <body> (blur/focusout fire before
      // the new focus lands), which is exactly when focus-trap code inside
      // a focusout handler tries its synchronous .focus() steal — hold the
      // shield through the gap.
      focusMoveUntil = Date.now() + 150;
      if (targetsHost) disguise(event);
      if (relatedIsHost) {
        try {
          Object.defineProperty(event, 'relatedTarget', {
            value: getDecoy(),
            configurable: true,
          });
        } catch {
          /* frozen event */
        }
      }
    };
    for (const type of ['focus', 'blur', 'focusin', 'focusout'] as const) {
      window.addEventListener(type, focusGuard, { capture: true });
    }

    const realFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (
      this: HTMLElement,
      ...args: Parameters<HTMLElement['focus']>
    ) {
      if (shellEngaged() && !isHost(this)) return;
      return realFocus.apply(this, args);
    };

    // Guards that consult document.activeElement instead of event.target —
    // and focus stealers that .blur() anything they don't recognize — see
    // the decoy while the shell has focus. Everything else passes through.
    if (realActiveGet) {
      try {
        Object.defineProperty(document, 'activeElement', {
          configurable: true,
          get(this: Document) {
            const active = realActiveGet.call(this) as Element | null;
            return active?.localName === HOST ? getDecoy() : active;
          },
        });
      } catch {
        /* page already sealed it — the event-level disguise still holds */
      }
    }
  },
});
