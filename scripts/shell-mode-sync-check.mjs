// The session-wide shell mode: closing the butler in one tab must close it
// in every tab (and reopening reopens everywhere), including tabs opened
// after the flip. Collapse/open is driven via SET_OPEN — the same
// collapse()/open() path Esc and the toggle command land in.
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
  chrome.storage.local.set({ devBypassAuth: true, onboardingDone: true });
});

const fail = async (message) => {
  console.error(`FAIL: ${message}`);
  await context.close();
  process.exit(1);
};

// The open shell shows the prompt textarea; the collapsed pill has none.
const isOpen = (page) => page.locator('#web-butler-root textarea').count();
const waitMode = async (page, open, label) => {
  for (let i = 0; i < 20; i++) {
    if (((await isOpen(page)) > 0) === open) return;
    await page.waitForTimeout(250);
  }
  await fail(label);
};

const tabA = await context.newPage();
await tabA.goto('https://example.com');
const tabB = await context.newPage();
await tabB.goto('https://example.org');
await waitMode(tabA, true, 'tab A shell did not mount open');
await waitMode(tabB, true, 'tab B shell did not mount open');
console.log('both tabs open');

// Close in A → B follows.
const setOpen = (page, open) =>
  sw.evaluate(
    async ({ url, open }) => {
      const tabs = await chrome.tabs.query({ url });
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'web-butler/set-open',
        open,
      });
    },
    { url: 'https://example.com/*', open },
  );
const setOpenB = (open) =>
  sw.evaluate(
    async ({ open }) => {
      const tabs = await chrome.tabs.query({ url: 'https://example.org/*' });
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'web-butler/set-open',
        open,
      });
    },
    { open },
  );

await setOpen(tabA, false);
await waitMode(tabA, false, 'tab A did not collapse');
await waitMode(tabB, false, 'tab B did not follow the collapse');
console.log('collapse in A closed B too');

// A tab opened AFTER the collapse mounts collapsed.
const tabC = await context.newPage();
await tabC.goto('https://example.net');
await tabC.waitForTimeout(1500);
if ((await isOpen(tabC)) > 0) {
  await fail('new tab mounted open despite the shared collapse');
}
console.log('new tab inherited the collapsed mode');

// Reopen from B → A and C follow.
await setOpenB(true);
await waitMode(tabB, true, 'tab B did not reopen');
await waitMode(tabA, true, 'tab A did not follow the reopen');
await waitMode(tabC, true, 'tab C did not follow the reopen');
console.log('reopen in B opened A and C too');

console.log('PASS');
await context.close();
