import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const extPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

const ctx = await chromium.launchPersistentContext('/tmp/wc-jank-profile-3', {
  headless: false,
  viewport: { width: 1100, height: 750 },
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
  ],
});

// Give the service worker a moment to register.
await new Promise((r) => setTimeout(r, 1500));
console.log('service workers:', ctx.serviceWorkers().map((w) => w.url()));

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('console', (msg) => console.log('[page console]', msg.type(), msg.text()));
await page.goto('https://example.com', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const state = await page.evaluate(() => {
  const host = document.querySelector('web-butler');
  return {
    hostExists: !!host,
    hostHtml: host ? host.outerHTML.slice(0, 200) : null,
    uiChildren: host?.shadowRoot?.querySelector('#web-butler-root')?.childElementCount ?? null,
  };
});
console.log('state:', JSON.stringify(state, null, 2));
await page.screenshot({ path: '.jank-frames/check.png' });
await ctx.close();
