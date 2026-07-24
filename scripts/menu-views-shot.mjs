// Screenshots of all five menu views with seeded data — the visual
// regression pass for the shared view kit (ViewFrame/ViewBody/ViewEmpty,
// ListRow, roving rows).
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
    extensions: [
      {
        id: 'ext-1',
        name: 'Hide sponsored posts',
        description: 'Folds away promoted posts in the feed',
        urlPatterns: ['https://example.com/*'],
        source: '/* noop */',
        enabled: true,
        createdAt: now - 86_400_000,
      },
      {
        id: 'ext-2',
        name: 'Compact tables',
        description: 'Tighter row spacing on pricing pages',
        urlPatterns: ['https://linear.app/*'],
        source: '/* noop */',
        enabled: false,
        createdAt: now - 3_600_000,
      },
    ],
  });
  chrome.storage.session.set({
    tasks: [
      {
        id: 't-run',
        scope: 'background',
        prompt: 'research acme corp and draft an email',
        url: 'https://example.com/',
        status: 'running',
        startedAt: now - 40_000,
        seen: true,
        activity: 'Reading acme.com',
      },
      {
        id: 't-done',
        scope: 'tab',
        prompt: 'summarize the pricing page',
        url: 'https://linear.app/pricing',
        status: 'done',
        startedAt: now - 7_200_000,
        finishedAt: now - 7_100_000,
        outcome: 'Pricing summary ready',
        reportId: 'r-1',
        seen: false,
      },
      {
        id: 't-fail',
        scope: 'tab',
        prompt: 'is this page tracking me?',
        url: 'https://example.com/',
        status: 'failed',
        startedAt: now - 90_000_000,
        finishedAt: now - 89_900_000,
        outcome: 'agent request failed',
        seen: true,
      },
    ],
    reports: [
      {
        id: 'r-1',
        title: 'Pricing summary',
        description: 'Plans, limits, and the cheapest viable tier',
        meta: 'linear.app · 4 plans',
        text: '# Pricing\n\nSummary…',
        createdAt: now - 7_100_000,
      },
    ],
  });
});

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(1500);

// Open the menu (defaults to Tasks view).
await page
  .locator('#web-butler-root button[aria-label*="enu"]')
  .first()
  .click();
await page.waitForTimeout(600);

const root = page.locator('#web-butler-root');
for (const view of ['Tasks', 'Artifacts', 'Extensions', 'Providers', 'Settings']) {
  await root.getByRole('button', { name: view, exact: true }).first().click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/menu-${view.toLowerCase()}.png` });
  console.log(`shot: /tmp/menu-${view.toLowerCase()}.png`);
}

await context.close();
