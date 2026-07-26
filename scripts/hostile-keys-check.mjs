// Hostile-page keyboard/focus check (the Hulu failure modes): a page that
//  (a) routes any keystroke it doesn't recognize as input-typing into
//      "player shortcuts" via capture-phase window listeners that
//      preventDefault + stopImmediatePropagation,
//  (b) preventDefaults mousedown/selectstart on unrecognized targets —
//      which kills focus-on-click and text selection while clicks still
//      "work",
//  (c) steals focus back to its player (focusout trap + interval sweep)
//      whenever the active element isn't an input it recognizes.
// The MAIN-world key guard (key-guard.content.ts) must make the Web Butler
// prompt fully usable against all three, without breaking the page's own
// inputs, hotkeys, or focus management.
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

// Install the hostile handlers the way a real site does: from page
// scripts, which always run AFTER a document_start content script.
await page.evaluate(() => {
  const isTyping = (el) =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof Element && el.isContentEditable);

  window.__shortcuts = 0;
  window.__steals = 0;

  // (a) the player-style hotkey layer.
  window.addEventListener(
    'keydown',
    (event) => {
      if (isTyping(event.target)) return;
      window.__shortcuts += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );

  // (b) pointer ownership: no focus/selection outside recognized inputs.
  for (const type of ['mousedown', 'selectstart']) {
    window.addEventListener(
      type,
      (event) => {
        if (!isTyping(event.target)) event.preventDefault();
      },
      { capture: true },
    );
  }

  // (c) the focus trap. A "player" surface that wants focus back whenever
  // it lands anywhere the site doesn't recognize.
  const player = document.createElement('div');
  player.id = 'player';
  player.tabIndex = -1;
  player.style.cssText = 'position:fixed;top:0;left:0;width:10px;height:10px';
  document.body.append(player);
  const steal = () => {
    window.__steals += 1;
    player.focus();
  };
  window.addEventListener(
    'focusout',
    (event) => {
      const next = event.relatedTarget;
      if (next && next !== player && !isTyping(next)) steal();
    },
    { capture: true },
  );
  setInterval(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== player && !isTyping(active)) {
      steal();
    }
  }, 120);

  // A page-owned input to prove normal behavior survives the guard.
  const input = document.createElement('input');
  input.id = 'page-input';
  input.style.cssText = 'position:fixed;top:8px;left:24px;z-index:1';
  document.body.append(input);
});

const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${name}: ${ok ? 'ok' : 'FAIL'}`);
};

// 1. Click into the prompt: focus must land AND stick in our textarea.
const prompt = page.locator('#web-butler-root textarea');
await prompt.click();
await page.waitForTimeout(600); // give the stealers time to try
const focused = await page.evaluate(
  () =>
    document.querySelector('web-butler')?.shadowRoot?.activeElement
      ?.localName ?? null,
);
check('click focuses the prompt (and it sticks)', focused === 'textarea');

// 2. Typing lands despite the shortcut layer.
await page.keyboard.type('still typing', { delay: 30 });
check(
  'typing lands in the prompt',
  (await prompt.inputValue()) === 'still typing',
);
check(
  'no keystrokes leaked into shortcuts',
  (await page.evaluate(() => window.__shortcuts)) === 0,
);

// 3. Text selection inside the prompt works (selectstart/mousedown guard).
await prompt.dblclick();
const selection = await page.evaluate(() => {
  const el = document
    .querySelector('web-butler')
    ?.shadowRoot?.querySelector('textarea');
  return el ? el.selectionEnd - el.selectionStart : -1;
});
check('double-click selects text in the prompt', selection > 0);

// 4. Enter still sends (isolated-world preventDefault stays real).
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('Enter sent the message', (await prompt.inputValue()) === '');

// 5. The page's own input still focuses, types, and keeps focus authority.
await page.click('#page-input');
await page.keyboard.type('page ok', { delay: 20 });
check(
  'page input still types',
  (await page.inputValue('#page-input')) === 'page ok',
);
const pageFocusWorks = await page.evaluate(() => {
  const input = document.getElementById('page-input');
  input.blur();
  input.focus();
  return document.activeElement === input;
});
check('page focus() still works when shell is idle', pageFocusWorks);

// 6. The page hotkey layer still owns keys pressed outside any input.
await page.evaluate(() => document.getElementById('page-input').blur());
await page.mouse.click(40, 300);
await page.keyboard.press('k');
await page.waitForTimeout(120);
check(
  'page hotkey fires for page keys',
  (await page.evaluate(() => window.__shortcuts)) === 1,
);

const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
await context.close();
process.exit(pass ? 0 : 1);
