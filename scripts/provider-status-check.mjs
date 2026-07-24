// Providers must never sit on "Checking…" forever. When the status fetch
// can't get an answer (server down, sandbox init failing), the rows must
// degrade to a retryable failed state after the hook's retries run out.
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
await sw.evaluate(() =>
  chrome.storage.local.set({ devBypassAuth: true, onboardingDone: true }),
);

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(1500);

// Open the menu and land on Providers.
await page
  .locator('#web-butler-root button[aria-label*="enu"]')
  .first()
  .click();
await page.waitForTimeout(400);
await page
  .locator('#web-butler-root')
  .getByRole('button', { name: 'Providers', exact: true })
  .first()
  .click();
await page.waitForTimeout(600);

const root = page.locator('#web-butler-root');
const counts = async () => ({
  checking: await root.getByText('Checking…').count(),
  retry: await root.getByRole('button', { name: 'Retry' }).count(),
  connect: await root.getByRole('button', { name: 'Connect' }).count(),
  connected: await root.getByText(/Active|Connected/).count(),
});

console.log('at open:', await counts());
// The hook retries at 2s, 4s, 6s, 8s — give it the full runway plus slack.
await page.waitForTimeout(25_000);
const after = await counts();
console.log('after 25s:', after);
await page.screenshot({ path: '/tmp/providers-status.png' });

await context.close();
if (after.checking > 0) {
  throw new Error('providers still stuck on Checking…');
}
console.log('PASS: no row left on Checking…');
