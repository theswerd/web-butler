// Codex onboarding end-to-end: open the shell, go to Providers, click
// Connect on the ChatGPT row, and confirm a real device code (from the
// sandbox VM's codex app-server) renders in the UI.
// Requires the server (apps/server) to be running on :8787.
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

// Wait for init (VM provisioning) so the login start has a sandbox.
let stored = {};
for (let i = 0; i < 45; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  stored = await sw.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  );
  if (stored.sandboxVmId) break;
}
console.log('sandbox vm id:', stored.sandboxVmId ?? '(none)');
if (!stored.sandboxVmId) {
  console.log('FAIL: no sandbox — is the server running?');
  await context.close();
  process.exit(1);
}

const page = await context.newPage();
await page.goto('https://example.com');
await page.waitForTimeout(800);

const shadow = (selector) => page.locator(`#web-butler-root ${selector}`);

// Open the menu (bowtie button), then the Providers view.
await shadow('button[aria-label*="enu"]').first().click();
await page.waitForTimeout(400);
await shadow('button:has-text("Providers")').click();
await page.waitForTimeout(400);

// The ChatGPT row's Connect button starts the device flow.
await shadow('button:has-text("Connect")').first().click();
console.log('clicked Connect — waiting for a device code…');

// Device code arrives once the VM's app-server mints it (a few seconds).
const code = shadow('a[href*="auth.openai.com"]');
await code.waitFor({ state: 'visible', timeout: 30000 });
console.log('device code shown:', (await code.innerText()).trim());
console.log(
  'verification link:',
  await code.getAttribute('href'),
);
console.log('PASS: codex onboarding UI end-to-end');

// Report the VM this run created so it can be cleaned up.
console.log('cleanup: test VM is', stored.sandboxVmId);
await context.close();
