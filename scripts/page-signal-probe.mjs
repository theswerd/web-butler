// Probe: capturePageSignal on a synthetic ad-heavy page must include the
// noise line (and must NOT on a clean page). Bundles the real module and
// evaluates it in a real DOM.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(dir, '../packages/ui/src/lib/page-signal.ts');
const bundle = execSync(
  `npx esbuild ${src} --bundle --format=iife --global-name=sig`,
  { cwd: path.resolve(dir, '..'), encoding: 'utf8' },
);

const adHeavy = `<!doctype html><title>Celebrity News Daily</title>
<meta name="description" content="The latest celebrity gossip and entertainment news.">
<h1>Star spotted at premiere</h1>
${'<div class="sponsored-post">Sponsored: buy this thing now, limited offer today</div>'.repeat(4)}
<ins class="adsbygoogle"></ins><div data-ad-slot="1"></div>
<p>The actress arrived at the premiere on Thursday evening wearing a designer gown that immediately set social media alight with commentary.</p>`;

const clean = `<!doctype html><title>RFC 9110</title>
<h1>HTTP Semantics</h1>
<p>This document describes the overall architecture of HTTP, establishes common terminology, and defines aspects shared by all versions.</p>`;

const browser = await chromium.launch();
const page = await browser.newPage();

const run = async (html) => {
  await page.setContent(html);
  await page.addScriptTag({ content: bundle });
  return page.evaluate(() => window.sig.capturePageSignal(document));
};

const noisy = await run(adHeavy);
if (!/Noise: about \d+ ad\/sponsored slots/.test(noisy)) {
  console.error('FAIL: ad-heavy page produced no noise line\n---\n' + noisy);
  process.exit(1);
}
console.log('ad-heavy page flagged:', noisy.match(/Noise:.*/)[0]);

const quiet = await run(clean);
if (/Noise:/.test(quiet)) {
  console.error('FAIL: clean page got a noise line\n---\n' + quiet);
  process.exit(1);
}
console.log('clean page stayed quiet');
console.log('PASS');
await browser.close();
