// Keyboard absorption check: typing in the Web Butler prompt must NOT
// trigger the page's own hotkeys (sites like YouTube/GitHub bind bare
// letters on document), while our own shell hotkeys (window capture) keep
// working, and page-focused typing still reaches the page as before.
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
// A typical site hotkey: bare "t" on document (bubble phase), with the
// usual guard that skips real inputs — which shadow retargeting defeats.
await page.addInitScript(() => {
  window.__hotkeyFired = 0;
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement;
    if (event.key === 't' && !typing) window.__hotkeyFired += 1;
  });
});
await page.goto('https://example.com');
await page.waitForTimeout(1500);

const fired = () => page.evaluate(() => window.__hotkeyFired);

// 1. Typing in the butler prompt (three "t"s) must not trip the hotkey.
const prompt = page.locator('#web-butler-root textarea');
await prompt.click();
await page.keyboard.type('test the t key', { delay: 20 });
const afterPrompt = await fired();
console.log('typed in prompt, hotkey fired (want 0):', afterPrompt);
const value = await prompt.inputValue();
console.log('prompt received the text:', value === 'test the t key');

// 2. Our own shell hotkey still works from inside the prompt: Esc collapses.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const collapsed = (await prompt.count()) === 0;
console.log('Esc still collapses the shell (want true):', collapsed);

// 3. With focus back on the page, the site hotkey works as before.
await page.mouse.click(40, 300);
await page.keyboard.press('t');
await page.waitForTimeout(100);
const afterPage = await fired();
console.log('pressed t on the page, hotkey fired (want 1):', afterPage);

const pass = afterPrompt === 0 && collapsed && afterPage === 1;
console.log(pass ? 'PASS' : 'FAIL');
await context.close();
process.exit(pass ? 0 : 1);
