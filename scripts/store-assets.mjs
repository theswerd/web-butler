/**
 * Chrome Web Store listing assets: designed marketing slides, not homepage
 * crops. Two passes:
 *
 *  1. Capture the demo window (real shell components, frozen via the
 *     homepage's ?scene= param) as crisp PNG art.
 *  2. Compose each slide: brand background, kicker, big serif headline,
 *     the window art with its own shadow. Screenshot at exactly 1280x800.
 *
 * JPEG output sidesteps the store's no-alpha rule. The promo tile is a
 * 440x280 dark brand card.
 *
 * Usage: node scripts/store-assets.mjs   (homepage dev server on :4180)
 * Output: apps/extension/store-assets/
 */
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'http://localhost:4180';
const OUT = 'apps/extension/store-assets';
await mkdir(OUT, { recursive: true });

const INK = '#171717';
const PAPER = '#f7f6f3';
const ACCENT = '#3b82f6';
const FONTS =
  '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">';

const bowtie = (ink, size = 30) => `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <path d="M3 8.2 H9.6 L11.6 12 L9.6 15.8 H3 L5.2 12 Z" fill="${ink}"/>
    <path d="M21 8.2 H14.4 L12.4 12 L14.4 15.8 H21 L18.8 12 Z" fill="${ink}"/>
    <rect x="10.7" y="9.8" width="2.6" height="4.4" rx="0.5" fill="${ACCENT}"/>
  </svg>`;

/** The provider logos, lifted from the homepage so they stay identical. */
const homepage = await readFile('apps/homepage/index.html', 'utf8');
const logoSvg = (name) => {
  const match = homepage.match(
    new RegExp(`logo-${name}"><svg([\\s\\S]*?)</svg>`),
  );
  if (!match) throw new Error(`logo-${name} not found in homepage/index.html`);
  return `<svg${match[1]}</svg>`;
};
const LOGOS = {
  chatgpt: logoSvg('chatgpt'),
  claude: logoSvg('claude'),
  grok: logoSvg('grok'),
};

const browser = await chromium.launch();

/** Pass 1 — the demo window per scene, as a data URI at 2x. */
async function captureWindow(scene) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${BASE}/?scene=${scene}`, { waitUntil: 'networkidle' });
  // Kill the window's own shadow; each slide draws its own.
  await page.addStyleTag({
    content: '.window { box-shadow: none !important; }',
  });
  await page.waitForTimeout(1200);
  const shot = await page.locator('.window').screenshot({ type: 'png' });
  await page.close();
  return `data:image/png;base64,${shot.toString('base64')}`;
}

/** Pass 2 — one composed slide. */
async function slide({ file, html }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(
    `<!doctype html><html><head>${FONTS}<style>
      * { margin: 0; box-sizing: border-box; }
      body {
        width: 1280px; height: 800px; overflow: hidden; position: relative;
        font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
      }
      .brand {
        position: absolute; top: 44px; left: 64px;
        display: flex; align-items: center; gap: 11px;
        font-weight: 600; font-size: 19px; letter-spacing: -0.01em;
      }
      h1 {
        font-family: 'IBM Plex Serif', Georgia, serif;
        font-weight: 600; letter-spacing: -0.015em; line-height: 1.06;
      }
      h1 em { font-style: italic; font-weight: 500; }
      .kicker {
        font-family: 'IBM Plex Mono', monospace; font-weight: 500;
        font-size: 15px; letter-spacing: 0.24em; color: ${ACCENT};
      }
      .sub { font-size: 21px; line-height: 1.5; }
      .art { border-radius: 14px; display: block; }
    </style></head><body>${html}</body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 92 });
  await page.close();
}

const art = await Promise.all(
  ['ask', 'report', 'form', 'edit'].map(captureWindow),
).then(([ask, report, form, edit]) => ({ ask, report, form, edit }));

/* Slide 1 — the dark brand opener. The whole point, unmissable: it runs
   on the AI plan the user ALREADY pays for. Named provider chips carry
   the message; the window peek grounds it as a product. */
const providerChip = (logo, name, color = '#fff') => `
  <span style="display:inline-flex; align-items:center; gap:12px;
               background:#232323; border:1px solid rgba(255,255,255,0.16);
               border-radius:999px; padding:14px 26px;
               font-weight:600; font-size:21px; color:#fff;">
    <span style="display:inline-flex; width:26px; height:26px; color:${color};">
      ${logo}
    </span>
    ${name}
  </span>`;

await slide({
  file: '1-hero.jpg',
  html: `
    <div style="position:absolute; inset:0; background:${INK};"></div>
    <div class="brand" style="color:#fff;">${bowtie('#fff')} Web Butler</div>
    <div style="position:absolute; top:122px; left:0; right:0; text-align:center;">
      <h1 style="color:#fff; font-size:68px;">Works with the AI<br>you <em>already pay for.</em></h1>
      <div style="display:flex; justify-content:center; gap:16px; margin-top:40px;">
        ${providerChip(LOGOS.chatgpt, 'ChatGPT')}
        ${providerChip(LOGOS.claude, 'Claude', '#d97757')}
        ${providerChip(LOGOS.grok, 'Grok')}
      </div>
      <p class="sub" style="color:#b9b9b9; margin-top:28px;">
        Sign in with your plan. It does the thinking, on every page. No new subscription.
      </p>
    </div>
    <img class="art" src="${art.ask}"
      style="position:absolute; left:50%; transform:translateX(-50%); bottom:-260px;
             width:860px; box-shadow: 0 30px 80px rgba(0,0,0,0.55);" />
  `,
});

/* Slides 2-5 — one capability each: headline block left, window right. */
const capability = ({ file, kicker, title, sub, img, artWidth = 850 }) =>
  slide({
    file,
    html: `
      <div style="position:absolute; inset:0; background:${PAPER};"></div>
      <div class="brand" style="color:${INK};">${bowtie(INK)} Web Butler</div>
      <div style="position:absolute; top:132px; left:64px; width:1152px;">
        <p class="kicker">${kicker}</p>
        <h1 style="color:${INK}; font-size:62px; margin-top:14px;">${title}</h1>
        <p class="sub" style="color:#5c5a55; margin-top:16px; max-width:760px;">${sub}</p>
      </div>
      <img class="art" src="${img}"
        style="position:absolute; left:50%; transform:translateX(-50%); bottom:-64px;
               width:${artWidth}px; border:1px solid rgba(0,0,0,0.07);
               box-shadow: 0 24px 70px rgba(23,23,23,0.18);" />
    `,
  });

await capability({
  file: '2-answers.jpg',
  kicker: 'ANSWERS',
  title: 'Ask about the page<br>you\u2019re on.',
  sub: 'Point at anything on the page and get a straight answer back.',
  img: art.ask,
});

await capability({
  file: '3-reports.jpg',
  kicker: 'REPORTS',
  title: 'Long answers,<br>properly filed.',
  sub: 'Tables, fine print, and the call, ready to copy or save as PDF.',
  img: art.report,
});

await capability({
  file: '4-errands.jpg',
  kicker: 'ERRANDS',
  title: 'Forms, filled before<br>your eyes.',
  sub: 'A visible cursor works your tab. You watch every click.',
  img: art.form,
});

await capability({
  file: '5-alterations.jpg',
  kicker: 'ALTERATIONS',
  title: 'Changes that stick.',
  sub: 'Hide the ads, fix the layout, say it once. Your alterations reapply on every visit.',
  img: art.edit,
});

/* Marquee promo tile — 1400x560 billboard: statement left, product right. */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 560 } });
  await page.setContent(
    `<!doctype html><html><head>${FONTS}<style>
      * { margin: 0; box-sizing: border-box; }
      body {
        width: 1400px; height: 560px; overflow: hidden; position: relative;
        background: ${INK}; font-family: 'IBM Plex Sans', sans-serif;
      }
      h1 {
        font-family: 'IBM Plex Serif', Georgia, serif; font-weight: 600;
        font-size: 56px; line-height: 1.1; letter-spacing: -0.015em; color: #fff;
      }
      h1 em { font-style: italic; font-weight: 500; }
      .brand {
        display: flex; align-items: center; gap: 11px;
        font-weight: 600; font-size: 19px; color: #fff;
      }
      .chips { display: flex; gap: 12px; margin-top: 30px; }
      .chip {
        display: inline-flex; align-items: center; gap: 9px;
        background: #232323; border: 1px solid rgba(255,255,255,0.16);
        border-radius: 999px; padding: 10px 18px;
        font-weight: 600; font-size: 16px; color: #fff;
      }
      .chip span { display: inline-flex; width: 20px; height: 20px; }
      .sub { font-size: 17px; color: #b9b9b9; margin-top: 22px; }
    </style></head><body>
      <div style="position:absolute; left:80px; top:50%; transform:translateY(-50%); width:600px;">
        <div class="brand" style="margin-bottom:26px;">${bowtie('#fff', 26)} Web Butler</div>
        <h1>Works with the AI<br>you <em>already pay for.</em></h1>
        <div class="chips">
          <span class="chip"><span>${LOGOS.chatgpt}</span> ChatGPT</span>
          <span class="chip"><span style="color:#d97757;">${LOGOS.claude}</span> Claude</span>
          <span class="chip"><span>${LOGOS.grok}</span> Grok</span>
        </div>
        <p class="sub">Answers, errands, and changes that stick, on every page.</p>
      </div>
      <img src="${art.ask}"
        style="position:absolute; right:64px; top:50%; transform:translateY(-50%);
               width:640px; border-radius:14px;
               box-shadow: 0 30px 80px rgba(0,0,0,0.55);" />
    </body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${OUT}/marquee-1400x560.jpg`,
    type: 'jpeg',
    quality: 92,
  });
  await page.close();
}

/* Promo tile — 440x280 dark brand card. */
{
  const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
  await page.setContent(
    `<!doctype html><html><head>${FONTS}<style>
      * { margin: 0; box-sizing: border-box; }
      body {
        width: 440px; height: 280px; overflow: hidden; background: ${INK};
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 16px;
        font-family: 'IBM Plex Sans', sans-serif;
      }
      .name {
        font-family: 'IBM Plex Serif', Georgia, serif; font-weight: 600;
        font-size: 44px; letter-spacing: -0.015em; color: #fff;
      }
      .tag { font-size: 15px; color: #b9b9b9; }
      .tag em { font-style: italic; font-family: 'IBM Plex Serif', serif; }
    </style></head><body>
      ${bowtie('#fff', 52)}
      <div class="name">Web Butler</div>
      <div class="tag">Your <em>AI subscription,</em> on every page.</div>
    </body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${OUT}/promo-tile-440x280.jpg`,
    type: 'jpeg',
    quality: 95,
  });
  await page.close();
}

await browser.close();
console.log('store assets written to', OUT);
