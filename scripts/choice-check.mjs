// Single-select follow-up now requires Submit: pick stages, Submit replies.
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
await prompt.fill('clean up this page');
await prompt.press('Enter');
console.log('sent single-choice fixture prompt, waiting out mock run…');
await page.waitForTimeout(11_000);

const submit = page.locator('#web-butler-root button', { hasText: 'Submit' });
console.log('submit button rendered for single select:', (await submit.count()) > 0);
console.log('submit disabled before a pick:', await submit.isDisabled());

await page.getByRole('radio', { name: 'Hide ads only' }).click();
console.log('picked "Hide ads only"; submit enabled:', !(await submit.isDisabled()));
await page.screenshot({ path: '/tmp/choice-picked.png' });

await submit.click();
await page.waitForTimeout(800);
// Submitting replies and closes the card — a fresh run should be working.
const cardGone =
  (await page.getByText('how aggressive should I be').count()) === 0;
console.log('choice card closed after submit:', cardGone);
const working = await page
  .locator('#web-butler-root', { hasText: 'Working' })
  .count();
console.log('submit started the next run (working shimmer):', working > 0);

await context.close();
