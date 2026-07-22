// Renders the Tux Bow extension icons: the BowtieMark artwork (static copy
// of packages/ui BowtieMark.tsx paths) on a soft rounded tile so the mark
// reads on both light and dark toolbars. Outputs the sizes Chrome wants.
//
//   node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'apps/extension/public/icon');
const SIZES = [16, 32, 48, 128];

const INK = '#171717';
const KNOT = '#3b82f6'; // default accent (blue)

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill="#fafafa" stroke="#d4d4d4" stroke-width="0.5"/>
  <path d="M3.6 8.45 H9.75 L11.62 12 L9.75 15.55 H3.6 L5.65 12 Z" fill="${INK}"/>
  <path d="M20.4 8.45 H14.25 L12.38 12 L14.25 15.55 H20.4 L18.35 12 Z" fill="${INK}"/>
  <rect x="10.8" y="9.95" width="2.4" height="4.1" rx="0.5" fill="${KNOT}"/>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>*{margin:0}body{background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({
    path: join(OUT_DIR, `${size}.png`),
    omitBackground: true,
  });
  await page.close();
  console.log(`icon/${size}.png`);
}
await browser.close();
