// Repro: does the task pill's document button actually open the side
// panel? Seeds a running task, clicks the button, and reports what the
// service worker saw (sidePanel.open call + result, panel contexts).
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

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');

await sw.evaluate(() => {
  chrome.storage.local.set({ devBypassAuth: true, onboardingDone: true });
  // A running task for the strip to show.
  chrome.storage.session.set({
    tasks: [
      {
        id: 'repro-task-1',
        scope: 'background',
        prompt: 'research acme corp and draft an email',
        url: 'https://example.com/',
        status: 'running',
        startedAt: Date.now() - 30_000,
        seen: false,
        activity: 'Reading the page',
      },
    ],
  });
  // Instrument sidePanel.open so we can see whether it was called and
  // how it resolved.
  globalThis.__panelLog = [];
  const realOpen = chrome.sidePanel.open.bind(chrome.sidePanel);
  chrome.sidePanel.open = (options, ...rest) => {
    globalThis.__panelLog.push(`open called: ${JSON.stringify(options)}`);
    const result = realOpen(options, ...rest);
    Promise.resolve(result).then(
      () => globalThis.__panelLog.push('open resolved'),
      (error) => globalThis.__panelLog.push(`open rejected: ${error?.message ?? error}`),
    );
    return result;
  };
  const realWarn = console.warn.bind(console);
  console.warn = (...args) => {
    globalThis.__panelLog.push(`warn: ${args.map(String).join(' ')}`);
    realWarn(...args);
  };
});

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(1800);

const pill = page.locator('#web-butler-root [aria-label^="Reply to this task"]');
console.log('pill visible:', await pill.count());
await pill.first().hover();
await page.waitForTimeout(300);

const docBtn = page.locator('#web-butler-root [aria-label="Open task activity"]');
console.log('doc button count:', await docBtn.count());
await docBtn.first().click();
await page.waitForTimeout(1500);

const log = await sw.evaluate(async () => {
  const contexts = await chrome.runtime.getContexts({});
  return {
    panelLog: globalThis.__panelLog,
    contexts: contexts.map((c) => `${c.contextType}: ${c.documentUrl ?? ''}`),
  };
});
console.log(JSON.stringify(log, null, 2));

await page.screenshot({ path: '/tmp/panel-open-check.png' });
await context.close();
