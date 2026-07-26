/**
 * Records the homepage demo scenes as promo footage.
 *
 * The homepage demo (apps/homepage) already performs the product: typing,
 * working, ghost-cursor form filling, the side panel serving a report.
 * This script stages the page so only the demo window is visible, clicks
 * each scenario tab to earn the full performance, and records it.
 *
 * Output: promo/public/footage/<scene>.mp4 (1080p-class, 2x CSS pixels)
 *         promo/public/footage/meta.json (window box + click timestamps)
 *
 * Requires: homepage dev server on :4180, ffmpeg on PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = 'http://localhost:4180';
const OUT = new URL('../public/footage/', import.meta.url).pathname;
const RAW = path.join(OUT, 'raw');
await mkdir(RAW, { recursive: true });

// The stage is an 860x640 CSS region; CDP pinch zoom (setPageScaleFactor)
// magnifies it 2x into a 1720x1280 recording. Pinch zoom leaves layout
// coordinates untouched, so the demo's ghost cursor stays accurate.
const STAGE = { width: 860, height: 640 };
const SCALE = 2;
const VIEW = { width: STAGE.width * SCALE, height: STAGE.height * SCALE };
const RECORD_SECONDS = 17;

const SCENES = [
  { id: 'ask', tab: 'Answers' },
  { id: 'edit', tab: 'Alterations' },
  { id: 'form', tab: 'Errands' },
  { id: 'report', tab: 'Reports' },
];

const STAGING_CSS = `
  /* Only the theater: everything else leaves the stage. */
  header.top, .hero, .how, .install, .faq, footer.foot, .demo-caption,
  .demo-tabs-row { display: none !important; }
  #demo-tabs { position: absolute !important; left: -9999px !important; opacity: 0 !important; }
  html, body { overflow: hidden !important; }
  body {
    display: block !important;
    padding: 0 !important; margin: 0 !important;
    width: ${STAGE.width}px; height: ${STAGE.height}px;
  }
  main, .wrap, .hero-row, .demo {
    all: unset !important;
    display: block !important;
  }
  /* Window top-anchored so growth extends downward, never re-centering. */
  .window {
    position: fixed !important;
    top: 56px !important;
    left: ${(STAGE.width - 660) / 2}px !important;
    width: 660px !important;
    max-width: none !important;
    margin: 0 !important;
    z-index: 5 !important;
  }
  ::-webkit-scrollbar { display: none !important; }
`;

const browser = await chromium.launch();
const meta = { scale: SCALE, view: VIEW, scenes: {} };

for (const scene of SCENES) {
  const context = await browser.newContext({
    viewport: VIEW,
    recordVideo: { dir: RAW, size: VIEW },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: STAGING_CSS });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: SCALE });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const stage = await page.evaluate(() => {
    const box = document.querySelector('.window')?.getBoundingClientRect();
    const bg = getComputedStyle(document.body).backgroundColor;
    return {
      bg,
      box: box
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : null,
    };
  });

  // The real click on the real tab: the demo treats it as a visitor's
  // choice and plays the whole scene, then holds the ending.
  const clickAtMs = Date.now() - t0;
  await page.evaluate((label) => {
    const tab = Array.from(
      document.querySelectorAll('#demo-tabs button'),
    ).find((b) => (b.textContent ?? '').trim() === label);
    if (!tab) throw new Error(`tab ${label} not found`);
    tab.click();
  }, scene.tab);

  await page.waitForTimeout(RECORD_SECONDS * 1000);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  const named = path.join(RAW, `${scene.id}.webm`);
  await rename(webm, named);

  meta.scenes[scene.id] = { clickAtMs, ...stage };
  console.log(`${scene.id}: recorded (click at ${clickAtMs}ms)`, stage.box);
}

await browser.close();

// H.264 for Remotion: precise seeking, universal decode.
for (const scene of SCENES) {
  execFileSync('ffmpeg', [
    '-y',
    '-i', path.join(RAW, `${scene.id}.webm`),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    '-an',
    path.join(OUT, `${scene.id}.mp4`),
  ], { stdio: 'ignore' });
  console.log(`${scene.id}.mp4 written`);
}

await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
await rm(RAW, { recursive: true, force: true });
console.log('footage complete:', (await readdir(OUT)).join(', '));
