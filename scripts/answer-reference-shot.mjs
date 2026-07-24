// The referenced answer card: click toggles the selection outline (same
// ring as a referenced task pill); a second click clears it.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(
  'http://localhost:6006/iframe.html?id=shell-answercard--answer-referenced',
);
await page.waitForTimeout(900);

const card = page.locator('[data-referenced]');
if ((await card.count()) !== 1) {
  console.error('FAIL: story did not start in the referenced state');
  process.exit(1);
}
await page.screenshot({ path: '/tmp/answer-referenced.png' });
console.log('shot: /tmp/answer-referenced.png (referenced)');

// Click the body — toggles the reference off.
await page.locator('.webbutler\\:relative').first().click({ position: { x: 200, y: 40 } });
await page.waitForTimeout(300);
if ((await page.locator('[data-referenced]').count()) !== 0) {
  console.error('FAIL: body click did not clear the reference');
  process.exit(1);
}
await page.screenshot({ path: '/tmp/answer-unreferenced.png' });
console.log('shot: /tmp/answer-unreferenced.png (cleared)');
console.log('PASS');
await browser.close();
