// First-run initialization: the background signs in anonymously against the
// local server and stores the bearer token; once a FREESTYLE_API_KEY is
// configured it also provisions + stores the sandbox VM id.
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

// Wait for the background service worker, then poll until init lands
// (sandbox provisioning includes a Freestyle VM create — allow ~30s).
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');

let stored = {};
for (let i = 0; i < 30; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  stored = await sw.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  );
  if (stored.sandboxVmId) break;
}
console.log('auth token stored:', Boolean(stored.authToken));
console.log('sandbox vm id:', stored.sandboxVmId ?? '(none)');

await context.close();
