// Two shell affordances, end to end on a real page:
//  1. Starter chips: with the shell open on a page, the background is
//     asked for AI-generated page starters (canned, title-specific ones
//     under devBypassAuth); tapping prefills (never sends) and the row
//     hides itself while the draft is non-empty.
//  2. "Ask Web Butler" (context menu): the menu item can't be clicked by
//     a harness, so this drives its message — a text selection lands as a
//     picked-element chip carrying the selected text, prompt focused.
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

const page = await context.newPage();
await page.goto('https://example.com');
// Starters are requested 1.2s after the shell is open; allow the round trip.
await page.waitForTimeout(3500);

const root = page.locator('#web-butler-root');

// 1a. The canned dev-bypass starters (title-specific + fixed ones).
const chip = root.getByRole('button', { name: 'List the key points here' });
if ((await chip.count()) !== 1) await fail('starter chips did not appear');
const titled = root.getByRole('button', { name: 'Dig into "Example Domain"' });
if ((await titled.count()) !== 1) {
  await fail('title-specific starter did not appear');
}
console.log('starter chips showing (page-specific)');
await page.screenshot({ path: '/tmp/starter-chips.png' });

// The context-menu item registered (the click itself can't be automated).
const menuCount = await sw.evaluate(
  () =>
    new Promise((resolve) => {
      // No query API for menu items; creating a duplicate id errors — use
      // that as the existence probe, then swallow the error.
      chrome.contextMenus.create(
        { id: 'web-butler-ask-selection', title: 'x', contexts: ['selection'] },
        () => resolve(chrome.runtime.lastError ? 1 : 0),
      );
    }),
);
if (menuCount !== 1) await fail('context-menu item was not registered');
console.log('context-menu item registered');

// 1b. Tap → prefill, focus, row hides. Nothing is sent.
await chip.click();
await page.waitForTimeout(400);
const draft = await root.locator('textarea').inputValue();
if (draft !== 'List the key points here') {
  await fail(`tap did not prefill the prompt (draft: "${draft}")`);
}
if ((await chip.count()) !== 0) {
  await fail('chips still showing with a non-empty draft');
}
console.log('tap prefilled the prompt and hid the row');

// 1c. Clearing the draft brings them back (not dismissed until a send).
await root.locator('textarea').fill('');
await page.waitForTimeout(400);
if ((await chip.count()) !== 1) {
  await fail('chips did not return after clearing the draft');
}
console.log('chips returned on cleared draft');

// 1d. The "Starter suggestions" setting hides/restores them live (the
//     shell watches the settings item, so no reload involved).
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...(settings ?? {}), starters: false },
  });
});
await page.waitForTimeout(500);
if ((await chip.count()) !== 0) {
  await fail('chips still showing with the setting off');
}
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...(settings ?? {}), starters: true },
  });
});
await page.waitForTimeout(500);
if ((await chip.count()) !== 1) {
  await fail('chips did not return after re-enabling the setting');
}
console.log('setting toggles the chips live');

// 2. The context-menu path: select page text, then deliver the menu
//    click's message the same way the background does.
await page.evaluate(() => {
  const p = document.querySelector('p');
  const range = document.createRange();
  range.selectNodeContents(p);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
});
const selected = await page.evaluate(() =>
  window.getSelection().toString().slice(0, 40),
);
await sw.evaluate(async (text) => {
  const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
  await chrome.tabs.sendMessage(tabs[0].id, {
    type: 'web-butler/ask-selection',
    text,
  });
}, selected);
await page.waitForTimeout(600);

// The selection's element lands as a context chip whose tooltip carries
// the selected text.
const chipWithText = root.locator(`[title*="${selected.slice(0, 20)}"]`);
if ((await chipWithText.count()) === 0) {
  await fail('selection did not land as a picked-element chip');
}
console.log('selection attached as a context chip');

// Starters yield to the picked element (mutually exclusive rows).
if ((await chip.count()) !== 0) {
  await fail('starter chips still showing next to a picked element');
}
console.log('starters yielded to the context chip');

await page.screenshot({ path: '/tmp/ask-selection.png' });
console.log('PASS');
await context.close();
