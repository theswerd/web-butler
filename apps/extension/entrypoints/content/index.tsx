import ReactDOM from 'react-dom/client';
import { App } from '../../components/App';
// Inlined so mounting never waits on a CSS network fetch (cssInjectionMode
// 'ui' fetches the stylesheet before mount, delaying the panel past first
// paint on every navigation).
import cssText from './style.css?inline';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manual',
  // Inject before first paint so the panel is there as the page appears,
  // instead of popping in at document_idle.
  runAt: 'document_start',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'web-butler',
      position: 'modal',
      zIndex: 2147483647,
      // :root doesn't match inside a shadow root; :host does.
      css: cssText.replaceAll(':root', ':host'),
      // Anchor to <html> (after <body>) so the host lives in the root
      // stacking context. If we sit inside <body> and the page gives <body>
      // its own stacking context (transform/filter/will-change) or injects
      // root-level overlays, our fixed panel gets trapped and loses even with
      // a max z-index. As a sibling of <body>, max z-index always wins.
      anchor: 'html',
      append: 'last',
      onMount(container, shadow, shadowHost) {
        // Full-viewport modal shell must not eat page clicks.
        shadowHost.style.pointerEvents = 'none';
        const shell = shadow.querySelector('html');
        if (shell instanceof HTMLElement) {
          shell.style.pointerEvents = 'none';
        }

        // Promote the host into the browser TOP LAYER via the Popover API.
        // z-index only competes within the normal painting order; the top
        // layer sits above ALL of it. Pages like Google put dropdowns/dialogs
        // in the top layer (via <dialog>/popover), and nothing in the normal
        // DOM — not even a max z-index — can beat that. Joining the top layer
        // is the only reliable way to stay above them.
        if (typeof shadowHost.showPopover === 'function') {
          shadowHost.setAttribute('popover', 'manual');
          // Strip the UA popover chrome so it stays a transparent, full-
          // viewport, click-through overlay instead of a centered fit-content
          // box with a border/background.
          const s = shadowHost.style;
          s.setProperty('position', 'fixed');
          s.setProperty('inset', '0');
          s.setProperty('width', 'auto');
          s.setProperty('height', 'auto');
          s.setProperty('max-width', 'none');
          s.setProperty('max-height', 'none');
          s.setProperty('margin', '0');
          s.setProperty('padding', '0');
          s.setProperty('border', '0');
          s.setProperty('background', 'transparent');
          s.setProperty('overflow', 'visible');

          const showInTopLayer = () => {
            // Throws InvalidStateError if already open — harmless.
            try {
              shadowHost.showPopover();
            } catch {
              /* already open or transiently disconnected */
            }
          };
          showInTopLayer();
          // Manual popovers shouldn't close on their own, but re-assert if the
          // browser ever evicts us from the top layer.
          shadowHost.addEventListener('toggle', (event) => {
            if ((event as Event & { newState?: string }).newState === 'closed') {
              requestAnimationFrame(showInTopLayer);
            }
          });
        }

        const root = document.createElement('div');
        root.id = 'web-butler-root';
        container.append(root);

        const reactRoot = ReactDOM.createRoot(root);
        reactRoot.render(<App />);
        return reactRoot;
      },
      onRemove(reactRoot) {
        reactRoot?.unmount();
      },
    });

    // At document_start <head> may not exist yet, and WXT's mount injects
    // document-level styles via `document.head ?? document.body` — which
    // throws on a headless document and silently kills the UI. Wait for
    // <head>; it appears long before first paint, so the panel still renders
    // with the page instead of popping in after it.
    await headReady();
    ui.autoMount();
  },
});

function headReady(): Promise<void> {
  return new Promise((resolve) => {
    if (document.head) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.head) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });
}
