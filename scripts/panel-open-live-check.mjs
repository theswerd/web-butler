// Live-run variant of panel-open-check: start a real run (dev bypass →
// local server), then click the pill's document button while the task
// streams, and confirm the side panel opens on the task view.
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
  globalThis.__panelLog = [];
  const realOpen = chrome.sidePanel.open.bind(chrome.sidePanel);
  chrome.sidePanel.open = (options, ...rest) => {
    globalThis.__panelLog.push(`open called: ${JSON.stringify(options)}`);
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

const prompt = page.locator('#web-butler-root textarea');
await prompt.fill('summarize this page in one line');
await prompt.press('Enter');

// Wait for the pill to show, then click its document button mid-run.
const pill = page.locator('#web-butler-root [aria-label^="Reply to this task"]');
await pill.first().waitFor({ timeout: 15_000 });
await pill.first().hover();
await page.waitForTimeout(300);
await page
  .locator('#web-butler-root [aria-label="Open task activity"]')
  .first()
  .click();
await page.waitForTimeout(1500);

const out = await sw.evaluate(async () => {
  const contexts = await chrome.runtime.getContexts({});
  const focus = (await chrome.storage.session.get('panelFocus')).panelFocus;
  const tasks = (await chrome.storage.session.get('tasks')).tasks ?? [];
  return {
    panelLog: globalThis.__panelLog,
    contexts: contexts.map((c) => c.contextType),
    focus,
    taskIds: tasks.map((t) => `${t.id} (${t.status})`),
  };
});
console.log(JSON.stringify(out, null, 2));
await context.close();
