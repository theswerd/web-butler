// Repro: typing into the Web Butler prompt on hulu.com. Instruments the
// page's keyboard handling to see WHY keystrokes don't land: records every
// key listener registration on window/document (with capture flag) and, for
// each keydown aimed at our shell host, whether something preventDefault'ed
// or halted it by the end of the dispatch.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dir, '../apps/extension/.output/chrome-mv3');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

{
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() =>
    chrome.storage.local.set({ devBypassAuth: true, onboardingDone: true }),
  );
}

const page = await context.newPage();
await page.addInitScript(() => {
  window.__keyRegs = [];
  window.__keyTrace = [];
  const KEYS = new Set(['keydown', 'keypress', 'keyup', 'beforeinput']);
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (KEYS.has(type)) {
      const capture =
        typeof options === 'boolean' ? options : Boolean(options?.capture);
      const where =
        this === window
          ? 'window'
          : this === document
            ? 'document'
            : this instanceof Element
              ? this.localName
              : String(this);
      window.__keyRegs.push({ type, capture, where });
    }
    return orig.call(this, type, listener, options);
  };
  // First capture listener on window (init scripts run before page code):
  // after the synchronous dispatch finishes, record what happened.
  window.addEventListener(
    'keydown',
    (event) => {
      const target =
        event.target instanceof Element ? event.target.localName : 'other';
      setTimeout(() => {
        window.__keyTrace.push({
          key: event.key,
          target,
          prevented: event.defaultPrevented,
          halted: event.cancelBubble,
        });
      }, 0);
    },
    { capture: true },
  );
});

await page.goto('https://www.hulu.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
console.log('url:', page.url());

const prompt = page.locator('#web-butler-root textarea');
const mounted = await prompt.count();
console.log('shell mounted:', mounted > 0);
if (mounted > 0) {
  await prompt.click();
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => {
    const host = document.querySelector('web-butler');
    const inner = host?.shadowRoot?.activeElement;
    return inner ? inner.localName : null;
  });
  console.log('focused inside shell:', focused);
  await page.keyboard.type('hello hulu', { delay: 40 });
  await page.waitForTimeout(500);
  const value = await prompt.inputValue();
  console.log('prompt value (want "hello hulu"):', JSON.stringify(value));

  const trace = await page.evaluate(() => window.__keyTrace.slice(0, 12));
  console.log('keydown trace:', JSON.stringify(trace, null, 1));
  const regs = await page.evaluate(() => window.__keyRegs);
  console.log('key listener registrations:', JSON.stringify(regs, null, 1));
}

await context.close();
