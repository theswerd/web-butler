// The side panel page fetches the stored report on mount, so loading
// sidepanel.html as a tab verifies exactly what the panel shows.
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
await page.waitForTimeout(1200);

const prompt = page.locator('#web-butler-root textarea');
await prompt.fill('research acme corp and draft an email to priya about it');
await prompt.press('Enter');
await page.waitForTimeout(11_000);

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extensionId = new URL(sw.url()).hostname;

const panelView = await context.newPage();
await panelView.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await panelView.waitForTimeout(800);
await panelView.setViewportSize({ width: 380, height: 700 });

const title = await panelView.getByText('Draft: ready to send').count();
const body = await panelView
  .getByText('Following up with what I found')
  .count();
console.log('report title rendered:', title > 0);
console.log('report body rendered:', body > 0);
await panelView.screenshot({ path: '/tmp/report-panel.png' });

await context.close();
