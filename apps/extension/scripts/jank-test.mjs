/**
 * Reproduces panel behavior across page navigations.
 * Launches Chrome with the dev extension, navigates A -> B, captures a CDP
 * screencast of the bottom-right corner plus mount-timing marks.
 *
 * Run: node scripts/jank-test.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const extPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'wc-frames-'));

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wc-profile-')), {
  headless: false,
  viewport: { width: 1100, height: 750 },
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
  ],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());

// Timing marks: when the host attaches and when the React UI actually renders.
await page.addInitScript(() => {
  window.__wc = { events: [{ name: 'doc-start', t: performance.now() }] };
  const log = (name) => window.__wc.events.push({ name, t: performance.now() });
  const check = () => {
    const host = document.querySelector('web-butler');
    if (host && !window.__wc.host) {
      window.__wc.host = true;
      log('host-attached');
    }
    const root = host?.shadowRoot?.querySelector('#web-butler-root');
    if (root && root.childElementCount > 0 && !window.__wc.ui) {
      window.__wc.ui = true;
      log('ui-rendered');
    }
  };
  const arm = () => {
    if (!document.documentElement) {
      setTimeout(arm, 0);
      return;
    }
    new MutationObserver(check).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    const onFrame = () => {
      if (!window.__wc.paint) {
        window.__wc.paint = true;
        log('first-raf');
      }
      check();
      if (!window.__wc.ui) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    check();
  };
  arm();
});

// Screencast the whole window; we'll crop mentally to bottom-right.
const cdp = await ctx.newCDPSession(page);
let frameIndex = 0;
const frameTimes = [];
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  const name = `frame-${String(frameIndex).padStart(3, '0')}.png`;
  writeFileSync(`${outDir}/${name}`, Buffer.from(data, 'base64'));
  frameTimes.push({ name, ts: metadata.timestamp });
  frameIndex += 1;
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

await page.goto('https://example.com', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await cdp.send('Page.startScreencast', {
  format: 'png',
  quality: 60,
  maxWidth: 1100,
  maxHeight: 750,
  everyNthFrame: 1,
});

const navStart = Date.now();
await page.goto('https://en.wikipedia.org/wiki/Glass', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await cdp.send('Page.stopScreencast');

const events = await page.evaluate(() => window.__wc?.events ?? []);
const navEnd = Date.now();

console.log('--- mount timing on new page (ms since doc-start) ---');
for (const e of events) console.log(`${e.name}: ${e.t.toFixed(1)}`);
console.log(`--- captured ${frameIndex} frames over ${navEnd - navStart}ms in ${outDir} ---`);
for (const f of frameTimes) console.log(`${f.name} @ ${f.ts}`);

await ctx.close();
