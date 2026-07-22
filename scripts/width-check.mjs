// Visual check: status pill (delegated ack) and notice toast should both
// span the full prompt-box width (560).
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
await prompt.fill('research acme corp and draft an email to priya');
await prompt.press('Enter');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/width-ack.png' });

await page.waitForTimeout(10_500);
await page.screenshot({ path: '/tmp/width-toast.png' });

await context.close();
