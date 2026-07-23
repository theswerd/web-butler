// Two-tab check of the run/task state model:
//  1. Tab-scoped: a page question answers in its own tab only.
//  2. Global: a "research + draft" prompt frees the origin prompt silently,
//     then toasts EVERY tab ~10s later and lists in the Tasks view.
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

const tabA = await context.newPage();
await tabA.goto('https://example.com');
const tabB = await context.newPage();
await tabB.goto('https://example.org');
await tabA.waitForTimeout(1500);

const promptIn = (page) => page.locator('#web-butler-root textarea');

// --- 1. Tab-scoped question in tab A --------------------------------------
await promptIn(tabA).fill('is this page tracking me?');
await promptIn(tabA).press('Enter');
console.log('[A] sent tab-scoped question');

// Concurrency model: the prompt frees right away; the running task shows
// as a strip chip (its body is the follow-up reference target).
await tabA.waitForTimeout(1000);
const stripA = await tabA
  .locator('#web-butler-root [aria-label^="Reply to this task"]')
  .count();
console.log('[A] task strip chip visible:', stripA > 0);

// ... and the same running task is visible from OTHER tabs too.
const stripInB = await tabB
  .locator('#web-butler-root [aria-label^="Reply to this task"]')
  .count();
console.log('[B] running task visible cross-tab:', stripInB > 0);

// --- 2. Global job from tab B ----------------------------------------------
await promptIn(tabB).fill(
  'Open a new tab, research acme corp, draft an email to priya about it',
);
await promptIn(tabB).press('Enter');
console.log('[B] sent global job');

// Delegated: B's prompt frees silently — no lingering working shimmer.
await tabB.waitForTimeout(800);
const shimmerB = await tabB
  .locator('#web-butler-root', { hasText: 'Working' })
  .count();
console.log('[B] prompt freed after delegation:', shimmerB === 0);
// Both tasks now on B's strip (its own global + A's tab question).
const stripCountB = await tabB
  .locator('#web-butler-root [aria-label^="Reply to this task"]')
  .count();
console.log('[B] strip shows both running tasks:', stripCountB >= 2);

// --- 3. Wait out the mock runs ---------------------------------------------
await tabA.waitForTimeout(11_000);

// Tab answer landed in A only.
const answerA = await tabA.getByText('3 trackers').count();
const answerB = await tabB.getByText('3 trackers').count();
console.log('[A] answer card in origin tab:', answerA > 0);
console.log('[B] answer leaked into B (want false):', answerB > 0);

// Finished global task toasted in BOTH tabs.
const toastA = await tabA.getByText('Email draft ready').count();
const toastB = await tabB.getByText('Email draft ready').count();
console.log('[A] task toast:', toastA > 0);
console.log('[B] task toast:', toastB > 0);

await tabA.screenshot({ path: '/tmp/state-tabA.png' });
await tabB.screenshot({ path: '/tmp/state-tabB.png' });

// --- 4. Tasks list: history + the tab question's row ------------------------
// Open the menu in A (bowtie button), which defaults to Tasks.
await tabA.locator('#web-butler-root button[aria-label*="enu"]').first().click();
await tabA.waitForTimeout(600);
const listedA = await tabA.getByText('Email draft ready').count();
console.log('[A] finished task listed in menu:', listedA > 0);
// The tab-scoped question shows up in the same history.
const tabTask = await tabA
  .locator('#web-butler-root')
  .getByText('is this page tracking me?')
  .count();
console.log('[A] tab question listed in menu:', tabTask > 0);
await tabA.screenshot({ path: '/tmp/state-tabA-menu.png' });

await context.close();
