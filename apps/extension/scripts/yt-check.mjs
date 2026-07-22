import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const extPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

const ctx = await chromium.launchPersistentContext('/tmp/wc-yt-profile', {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--mute-audio',
  ],
});

await new Promise((r) => setTimeout(r, 1500));

const page = ctx.pages()[0] ?? (await ctx.newPage());

async function inspect(url, name) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const html = document.documentElement;
    const host = document.querySelector('web-butler');
    const root = host?.shadowRoot?.querySelector('#web-butler-root');
    const pill = root?.querySelector('button, div > div');
    const rootCs = root ? getComputedStyle(root) : null;
    return {
      htmlFontSize: getComputedStyle(html).fontSize,
      htmlLineHeight: getComputedStyle(html).lineHeight,
      hostExists: !!host,
      rootFontSize: rootCs?.fontSize,
      rootFontFamily: rootCs?.fontFamily,
      pillRect: pill ? pill.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log(`--- ${name} ---`);
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: `.jank-frames/yt-${name}.png` });
  // zoomed crop of bottom center where the pill lives
  await page.screenshot({
    path: `.jank-frames/yt-${name}-crop.png`,
    clip: { x: 440, y: 640, width: 400, height: 160 },
  });
}

await inspect('https://example.com', 'example');
await inspect('https://www.youtube.com', 'youtube');

await ctx.close();
