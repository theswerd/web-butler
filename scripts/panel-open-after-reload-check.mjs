// The dev-loop failure mode: the extension reloads (watch-build →
// runtime.reload) while a tab sits open, orphaning its content script —
// the shell renders but every sendMessage dies silently, so the task
// pill's document button "does nothing". The fix re-executes the content
// script into open tabs (onInstalled → remountContentScripts) and the
// script tears down the stale host before mounting.
//
// Playwright can't reattach to the service worker across runtime.reload,
// so this exercises the same mechanics without it: inject the content
// script a SECOND time into a tab that already has a shell (exactly what
// the onInstalled remount does), then assert (1) exactly one <web-butler>
// host remains and (2) the pill's document button opens the side panel.
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
  chrome.storage.session.set({
    tasks: [
      {
        id: 'remount-task',
        scope: 'background',
        prompt: 'research acme corp',
        url: 'https://example.com/',
        status: 'running',
        startedAt: Date.now() - 30_000,
        seen: false,
        activity: 'Reading the page',
      },
    ],
  });
  globalThis.__panelLog = [];
  const realOpen = chrome.sidePanel.open.bind(chrome.sidePanel);
  chrome.sidePanel.open = (options, ...rest) => {
    globalThis.__panelLog.push('open called');
    const result = realOpen(options, ...rest);
    Promise.resolve(result).then(
      () => globalThis.__panelLog.push('open resolved'),
      (error) =>
        globalThis.__panelLog.push(`open rejected: ${error?.message ?? error}`),
    );
    return result;
  };
});

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(1500);

const hostCount = () =>
  page.evaluate(() => document.querySelectorAll('web-butler').length);
console.log('hosts after first mount:', await hostCount());

// The remount, exactly as the background's onInstalled handler runs it.
await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-scripts/content.js'],
    });
  }
});
await page.waitForTimeout(1500);
const hosts = await hostCount();
console.log('hosts after remount:', hosts);
if (hosts !== 1) throw new Error(`expected exactly 1 host, got ${hosts}`);

const pill = page.locator('#web-butler-root [aria-label^="Reply to this task"]');
console.log('pill count:', await pill.count());
await pill.first().hover();
await page.waitForTimeout(300);
await page
  .locator('#web-butler-root [aria-label="Open task activity"]')
  .first()
  .click();
await page.waitForTimeout(1800);

const out = await sw.evaluate(async () => ({
  panelLog: globalThis.__panelLog,
  contexts: (await chrome.runtime.getContexts({})).map((c) => c.contextType),
  focus: (await chrome.storage.session.get('panelFocus')).panelFocus,
}));
console.log(JSON.stringify(out, null, 2));

const openedFallbackTab = context
  .pages()
  .some((p) => p.url().includes('sidepanel.html'));
console.log('fallback tab opened:', openedFallbackTab);

await context.close();
if (!out.contexts.includes('SIDE_PANEL')) {
  throw new Error('side panel never opened');
}
if (openedFallbackTab) {
  throw new Error('fallback tab opened despite a working panel');
}
console.log('PASS');
