// Settings' "Erase everything": seed an onboarded profile with state, click
// the erase button twice (arm + confirm), and verify the extension wipes
// storage, reloads, and comes back showing the first-run sign-in.
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
  const now = Date.now();
  chrome.storage.local.set({
    devBypassAuth: true,
    onboardingDone: true,
    authToken: 'seeded-token',
    sandboxVmId: 'seeded-vm',
    extensions: [
      {
        id: 'ext-1',
        name: 'Hide sponsored posts',
        description: 'Folds away promoted posts',
        urlPatterns: ['https://example.com/*'],
        source: '/* noop */',
        enabled: true,
        createdAt: now,
      },
    ],
  });
  chrome.storage.session.set({
    tasks: [
      {
        id: 't-done',
        scope: 'tab',
        prompt: 'summarize the pricing page',
        url: 'https://linear.app/pricing',
        status: 'done',
        startedAt: now - 7_200_000,
        finishedAt: now - 7_100_000,
        outcome: 'Pricing summary ready',
        seen: true,
      },
    ],
  });
});

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(1500);

const root = page.locator('#web-butler-root');

// Onboarded: the prompt shell (not the welcome card) should be up.
if ((await root.getByText('Your butler for the web').count()) > 0) {
  console.error('FAIL: onboarding card showing before reset — bad seed');
  await context.close();
  process.exit(1);
}

// Menu → Settings → Erase (arm) → Yes, erase (confirm).
await page
  .locator('#web-butler-root button[aria-label*="enu"]')
  .first()
  .click();
await page.waitForTimeout(500);
await root.getByRole('button', { name: 'Settings', exact: true }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/reset-1-settings.png' });

const erase = root.getByRole('button', { name: 'Erase…', exact: true });
await erase.click();
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/reset-2-armed.png' });
const confirm = root.getByRole('button', { name: 'Yes, erase', exact: true });
if ((await confirm.count()) === 0) {
  console.error('FAIL: arm click did not show the confirm state');
  await context.close();
  process.exit(1);
}
console.log('armed state showing');
// Plain click can hang: the reset tears the shell down ~150ms after the
// handler runs and Playwright's actionability checks race the teardown.
// dispatchEvent fires the handler without them.
await confirm.dispatchEvent('click');

// The background wipes storage and reloads. The old worker must die — that
// proves runtime.reload() fired. (Playwright can't hand us the NEW worker
// after a reload, so the wipe itself is asserted through the UI below.)
// evaluate() on a torn-down worker can hang forever rather than reject —
// race it against a timeout and treat both outcomes as "dead".
const workerAlive = () =>
  Promise.race([
    sw.evaluate(() => 1).then(
      () => true,
      () => false,
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
let oldDied = false;
for (let i = 0; i < 10 && !oldDied; i++) {
  await new Promise((r) => setTimeout(r, 500));
  oldDied = !(await workerAlive());
}
if (!oldDied) {
  console.error('FAIL: service worker still alive — reload never happened');
  await context.close();
  process.exit(1);
}
console.log('extension reloaded (old worker torn down)');

// The remounted shell should be back on the first-run sign-in — that's only
// possible if onboardingDone was actually wiped.
let onboarding = false;
for (let i = 0; i < 30 && !onboarding; i++) {
  await new Promise((r) => setTimeout(r, 500));
  onboarding = (await root.getByText('Your butler for the web').count()) > 0;
}
await page.screenshot({ path: '/tmp/reset-3-after.png' });
if (!onboarding) {
  console.error('FAIL: shell did not return to the onboarding sign-in');
  await context.close();
  process.exit(1);
}

// That's as far as this harness can see: under --load-extension, Chromium
// tears the extension down on runtime.reload() but never brings it back,
// so the post-reload remount (fresh shell, menu closed) can't be observed
// here. Real Chrome restarts the extension and onInstalled remounts the
// content scripts — the exact path the dev loop exercises on every rebuild
// and panel-open-after-reload-check.mjs verifies in isolation.
console.log('PASS: reset wiped state, reloaded, and returned to sign-in');
await context.close();
