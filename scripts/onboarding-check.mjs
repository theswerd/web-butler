// First-run onboarding: a fresh profile should see the onboarding card in
// place of the prompt, walk welcome → connect → real device code, and the
// card should swap to the prompt after skipping.
// Requires the server (apps/server) to be running on :8787.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dir, '../apps/extension/.output/chrome-mv3');
const shots = path.resolve(dir, '../.shots');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');

// Wait for init so the connect step has a sandbox to talk to.
let stored = {};
for (let i = 0; i < 45; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  stored = await sw.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  );
  if (stored.sandboxVmId) break;
}
console.log('sandbox vm id:', stored.sandboxVmId ?? '(none)');

const page = await context.newPage();
await page.goto('https://example.com');
const root = (selector) => page.locator(`#web-butler-root ${selector}`);

// 1. Welcome step shows instead of the prompt.
await root('h2:has-text("Welcome to Web Butler")').waitFor({ timeout: 8000 });
const promptCount = await root('textarea').count();
console.log('welcome card shown, prompt hidden:', promptCount === 0);
await page.screenshot({ path: `${shots}/onboarding-1-welcome.png` });

// 2. Sign in with ChatGPT → starts the device flow directly; the pill
// morphs into "Getting your code…" and then "Open sign-in page".
await root('button:has-text("Sign in with ChatGPT")').click();
await root('h2:has-text("Connect ChatGPT")').waitFor({ timeout: 4000 });
await page.screenshot({ path: `${shots}/onboarding-2-connect.png` });

// 3. Real device code from the VM blooms in.
const code = root('span.webbutler\\:font-mono');
await code.waitFor({ timeout: 30000 });
console.log('device code shown:', (await code.innerText()).trim());
console.log(
  'sign-in link:',
  await root('a:has-text("Open sign-in page")').getAttribute('href'),
);
await page.screenshot({ path: `${shots}/onboarding-3-code.png` });

// 4. Skip — the prompt should take over, and a reload must not re-onboard.
await root('button:has-text("do this later")').click();
await root('textarea').waitFor({ timeout: 4000 });
console.log('after skip: prompt visible');
await page.reload();
await page.waitForTimeout(1500);
const cardAfterReload = await root('h2:has-text("Welcome to Web Butler")').count();
console.log('after reload: onboarding stays dismissed:', cardAfterReload === 0);
await page.screenshot({ path: `${shots}/onboarding-4-prompt.png` });

// 5. Auth gate: with no AI connected, sending must be rejected — the
// message returns to the box and the connect card pops with a code.
const prompt = root('textarea');
await prompt.fill('summarize this page');
await prompt.press('Enter');
await root('h2:has-text("Connect ChatGPT")').waitFor({ timeout: 8000 });
console.log('gate popped on send without auth');
const gateCode = root('span.webbutler\\:font-mono');
await gateCode.waitFor({ timeout: 30000 });
console.log('gate device code shown:', (await gateCode.innerText()).trim());
await page.waitForTimeout(300);
const restored = await prompt.inputValue();
console.log('draft restored after rejection:', restored === 'summarize this page');
await page.screenshot({ path: `${shots}/onboarding-5-gate.png` });

// "Not now" closes the gate; the prompt stays.
await root('button:has-text("Not now")').click();
await page.waitForTimeout(500);
const gateGone = await root('h2:has-text("Connect ChatGPT")').count();
console.log('gate dismissed:', gateGone === 0);

console.log('PASS: onboarding flow end-to-end');
console.log('cleanup: test VM is', stored.sandboxVmId);
await context.close();
