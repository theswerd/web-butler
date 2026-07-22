// The Claude sign-in redirects to claude.ai/login (a sibling domain of the
// claude.com verification URL). On that tab the card must park its open
// button as the inert "You're on the sign-in page" marker.
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

let stored = {};
for (let i = 0; i < 45; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  stored = await sw.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  );
  if (stored.sandboxVmId) break;
}
console.log('sandbox vm id:', stored.sandboxVmId ?? '(none)');

// Start the Claude flow from a neutral page.
const page = await context.newPage();
await page.goto('https://example.com');
const root = (selector) => page.locator(`#web-butler-root ${selector}`);
await root('button:has-text("Sign in with Claude")').click();
await root('a:has-text("Open sign-in page")').waitFor({ timeout: 60000 });
console.log('claude flow pending on example.com');

// Now visit the login page the redirect actually lands on — claude.ai,
// not claude.com. The card (in-flight → connect) must show the inert pill.
const login = await context.newPage();
await login.goto('https://claude.ai/login?selectAccount=true');
await login
  .locator('#web-butler-root')
  .locator('text=You’re on the sign-in page')
  .waitFor({ timeout: 20000 });
console.log('claude.ai/login shows: You’re on the sign-in page');
await login.screenshot({ path: `${shots}/claude-signin-page.png` });

console.log('PASS: sibling-domain sign-in page detection');
console.log('cleanup: test VM is', stored.sandboxVmId);
await context.close();
