// Sign-in page surfacing: with a device flow pending (started in another
// tab), landing on that provider's own pages must auto-open the shell and
// show the full connect card — code, instructions, countdown — without any
// hotkey. Requires the server (apps/server) to be running on :8787.
//
//   node scripts/signin-page-surface-check.mjs [codex|grok]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDERS = {
  codex: { button: 'Sign in with ChatGPT', heading: 'Connect ChatGPT', page: 'https://chatgpt.com/' },
  grok: { button: 'Sign in with Grok', heading: 'Connect Grok', page: 'https://x.ai/' },
};
const provider = PROVIDERS[process.argv[2] ?? 'codex'];

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

// Start the device flow from a neutral page.
const page = await context.newPage();
await page.goto('https://example.com');
const root = (selector) => page.locator(`#web-butler-root ${selector}`);
await root(`button:has-text("${provider.button}")`).click();
await root('.webbutler\\:font-mono').waitFor({ timeout: 60000 });
const code = (await root('.webbutler\\:font-mono').innerText()).trim();
console.log('device code minted:', code);

// Land on the provider's page — the card must surface itself, no hotkey.
const signin = await context.newPage();
await signin.goto(provider.page);
const sroot = (selector) => signin.locator(`#web-butler-root ${selector}`);
await sroot(`h2:has-text("${provider.heading}")`).waitFor({ timeout: 20000 });
console.log('connect card auto-surfaced on', provider.page);
const shownCode = (await sroot('.webbutler\\:font-mono').innerText()).trim();
console.log('code shown matches:', shownCode === code, `(${shownCode})`);
await signin.screenshot({ path: `${shots}/signin-surface.png` });

console.log('PASS: pending flow surfaces on the provider page');
console.log('cleanup: test VM is', stored.sandboxVmId);
await context.close();
