// Screenshots of the redesigned choice rows: single (sliding accent dot)
// and multi (check settles in on the right).
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

// Mock-mode setup: skip onboarding and bypass the auth gate so canned runs
// work without a real ChatGPT sign-in.
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

// Single select.
await prompt.fill('clean up this page');
await prompt.press('Enter');
await page.waitForTimeout(10_800);
await page.getByRole('radio', { name: 'Ads + floating widgets' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/choice-single.png' });
await page.locator('#web-butler-root button[aria-label="Dismiss"]').click();

// Multi select.
await prompt.fill('block the trackers on this site');
await prompt.press('Enter');
await page.waitForTimeout(10_800);
await page.getByRole('checkbox', { name: 'Google Analytics' }).click();
await page.getByRole('checkbox', { name: 'Microsoft Clarity' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/choice-multi.png' });

await context.close();
