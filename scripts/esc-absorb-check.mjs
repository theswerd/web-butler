// Esc ownership check: while the shell is OPEN, a bare Escape belongs to
// Web Butler — the page must never see it (keydown OR keyup, capture OR
// bubble), whether focus is in our prompt or on the page. While the shell
// is collapsed, Esc flows to the page untouched. Inside the shell the
// close-priority still holds: menu closes first (shell stays open), search
// field clears first (menu stays open), then the shell collapses.
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

// The page's Esc consumers, installed like a real site's (after load):
// capture on window and bubble on document, keydown and keyup.
await page.evaluate(() => {
  window.__esc = { down: 0, up: 0 };
  window.addEventListener(
    'keydown',
    (e) => e.key === 'Escape' && (window.__esc.down += 1),
    { capture: true },
  );
  document.addEventListener(
    'keyup',
    (e) => e.key === 'Escape' && (window.__esc.up += 1),
  );
});
const esc = () => page.evaluate(() => window.__esc);
const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${name}: ${ok ? 'ok' : 'FAIL'}`);
};

const prompt = page.locator('#web-butler-root textarea');
const pill = page.getByRole('button', { name: /Open Web Butler/ });

// 1. Open shell, focus in prompt: Esc collapses, page sees nothing.
await prompt.click();
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Esc in prompt collapses shell', (await prompt.count()) === 0);
let counts = await esc();
check('page saw nothing (prompt)', counts.down === 0 && counts.up === 0);

// 2. Collapsed: Esc flows to the page (keydown and keyup).
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
counts = await esc();
check('collapsed Esc passes through', counts.down === 1 && counts.up === 1);

// 3. Open again; focus on the PAGE (not our prompt): Esc still ours.
await pill.click();
await page.waitForTimeout(600);
await page.mouse.click(40, 300);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Esc with page focus collapses shell', (await prompt.count()) === 0);
counts = await esc();
check('page saw nothing (page focus)', counts.down === 1 && counts.up === 1);

// 4. Menu open: first Esc closes the menu (shell stays), second collapses.
await pill.click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Menu/ }).click();
await page.waitForTimeout(600);
const menuList = page.locator('#web-butler-root [role="tablist"], #web-butler-root nav');
const menuOpen = (await menuList.count()) > 0;
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const menuClosed = (await menuList.count()) === 0;
const shellStillOpen = (await prompt.count()) === 1;
check('Esc closes menu first, shell stays', menuOpen && menuClosed && shellStillOpen);
counts = await esc();
check('page saw nothing (menu)', counts.down === 1 && counts.up === 1);

const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
await context.close();
process.exit(pass ? 0 : 1);
