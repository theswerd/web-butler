// Screenshot of the task strip mid-run: two concurrent tasks, one chip
// selected as the follow-up target.
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
await page.goto('https://example.com');
await page.waitForTimeout(1500);

const prompt = page.locator('#web-butler-root textarea');
await prompt.fill('is this page tracking me?');
await prompt.press('Enter');
await page.waitForTimeout(400);
await prompt.fill('research acme corp and draft an email to priya');
await prompt.press('Enter');
await page.waitForTimeout(800);

await page.screenshot({ path: '/tmp/strip-two-running.png' });

// Select the first chip (arm a follow-up) and reshoot.
await page
  .locator('#web-butler-root [aria-label^="Reply to this task"]')
  .first()
  .click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/strip-selected.png' });

await context.close();
console.log('shots: /tmp/strip-two-running.png /tmp/strip-selected.png');
