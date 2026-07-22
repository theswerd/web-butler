// Artifacts flow: global draft → minimal toast with explicit Open button →
// Artifacts menu view lists name+description → row click opens side panel.
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

// Toast: minimal pill — the whole thing is the open target.
const toast = page.locator('#web-butler-root [role="button"][aria-label^="Open:"]');
console.log('toast rendered:', (await toast.count()) > 0);
await page.screenshot({ path: '/tmp/artifacts-toast.png' });

await toast.first().click();
await page.waitForTimeout(1500);
const cdp = await context.newCDPSession(page);
let { targetInfos } = await cdp.send('Target.getTargets');
console.log(
  'panel opened from toast Open:',
  targetInfos.some((t) => t.url.includes('sidepanel.html')),
);

// Artifacts menu view.
await page.locator('#web-butler-root button[aria-label*="enu"]').first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Artifacts' }).click();
await page.waitForTimeout(500);
const name = await page.getByText('Draft: ready to send').count();
const description = await page
  .getByText('Email draft from the background research')
  .count();
console.log('artifact name listed:', name > 0);
console.log('artifact description listed:', description > 0);
await page.screenshot({ path: '/tmp/artifacts-menu.png' });

await context.close();
