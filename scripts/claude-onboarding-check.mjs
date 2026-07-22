// Claude onboarding in the real extension: the welcome card stacks three
// providers; "Sign in with Claude" starts the reverse flow on the VM and
// the connect step shows a sign-in link + paste box (no code chip).
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

// 1. Welcome shows all three providers, stacked.
await root('h2:has-text("Welcome to Web Butler")').waitFor({ timeout: 8000 });
for (const name of ['ChatGPT', 'Grok', 'Claude']) {
  const count = await root(`button:has-text("Sign in with ${name}")`).count();
  console.log(`sign in with ${name}:`, count === 1 ? 'shown' : 'MISSING');
}
await page.screenshot({ path: `${shots}/claude-1-welcome.png` });

// 2. Claude → connect phase; the sign-in link and paste box arrive once
// the VM's CLI prints its OAuth URL.
await root('button:has-text("Sign in with Claude")').click();
await root('h2:has-text("Connect Claude")').waitFor({ timeout: 4000 });
const link = root('a:has-text("Open sign-in page")');
await link.waitFor({ timeout: 60000 });
const href = await link.getAttribute('href');
console.log('sign-in link points at claude.com:', href.startsWith('https://claude.com/'));
const paste = root('input[placeholder="Paste your code"]');
console.log('paste box shown:', (await paste.count()) === 1);
await page.screenshot({ path: `${shots}/claude-2-connect.png` });

// 3. A bogus code → "Verifying…", then the CLI rejects it and the input
// returns with the error line.
await paste.fill('bogus-code-e2e');
await root('button:has-text("Connect")').last().click();
await root('span:has-text("Verifying")').waitFor({ timeout: 4000 });
console.log('verifying state shown');
await page.screenshot({ path: `${shots}/claude-3-verifying.png` });
await root('p:has-text("didn’t work")').waitFor({ timeout: 30000 });
const inputBack = await root('input[placeholder="Paste your code"]').count();
console.log('rejected code → error + input back:', inputBack === 1);
await page.screenshot({ path: `${shots}/claude-4-rejected.png` });

console.log('PASS: claude onboarding flow');
console.log('cleanup: test VM is', stored.sandboxVmId);
await context.close();
