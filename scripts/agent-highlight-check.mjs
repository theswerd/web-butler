// The agent highlight tool, end to end in the storybook demo:
//  1. highlight: links in the answer render as marker chips (the custom
//     scheme must survive react-markdown's URL sanitizer);
//  2. markers render but nothing scrolls or opens on its own;
//  3. clicking a chip scrolls the page to the section and opens its note;
//  4. clicking the other chip moves focus; the note's X dismisses it.
//
// Clicks are dispatched on the elements (dispatchEvent) rather than by
// coordinates: headless-shell silently drops coordinate clicks over this
// fixed-overlay stack (elementFromPoint resolves the chip correctly, so
// real pointer hit-testing is fine — it's a harness artifact).
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
await page.goto(
  'http://localhost:6006/iframe.html?id=shell-agenthighlight--demo',
);
await page.waitForTimeout(1200);

const fail = async (message) => {
  console.error(`FAIL: ${message}`);
  await page.screenshot({ path: '/tmp/agent-highlight-fail.png' });
  await browser.close();
  process.exit(1);
};

// 1. Two link chips in the answer card.
const pricingChip = page.getByRole('button', { name: 'the pricing table' });
const emailChip = page.getByRole('button', { name: 'email field' });
if ((await pricingChip.count()) !== 1 || (await emailChip.count()) !== 1) {
  await fail('highlight: links did not render as chips');
}

// 2. Two marker tabs on the page; no note open; no scroll yet.
const tabs = page.getByRole('button', { name: 'Show this highlight note' });
if ((await tabs.count()) !== 2) await fail('expected 2 marker corner tabs');
if ((await page.getByText('client-side validated').count()) !== 0) {
  await fail('a note card is open before any click');
}
if ((await page.evaluate(() => window.scrollY)) !== 0) {
  await fail('page scrolled proactively');
}
await page.screenshot({ path: '/tmp/agent-highlight-1-rest.png' });
console.log('rest state: chips + quiet markers, no scroll, no notes');

// 3. Click the pricing chip: scroll + note.
await pricingChip.dispatchEvent('click');
await page.waitForTimeout(900);
if ((await page.evaluate(() => window.scrollY)) === 0) {
  await fail('chip click did not scroll to the highlight');
}
if ((await page.getByText('is the only plan with SSO').count()) !== 1) {
  await fail('pricing note did not open');
}
await page.screenshot({ path: '/tmp/agent-highlight-2-pricing.png' });
console.log('pricing chip: scrolled and opened its note');

// 4. Click the email chip: focus moves (one note at a time).
await emailChip.dispatchEvent('click');
await page.waitForTimeout(900);
if ((await page.getByText('client-side validated').count()) !== 1) {
  await fail('email note did not open');
}
if ((await page.getByText('is the only plan with SSO').count()) !== 0) {
  await fail('both notes are open at once');
}
await page.screenshot({ path: '/tmp/agent-highlight-3-email.png' });
console.log('email chip: focus moved, single note open');

// 5. Dismiss via the note's X.
await page.getByRole('button', { name: 'Dismiss note' }).dispatchEvent('click');
// The note leaves through a spring exit animation; give it time to unmount.
await page.waitForTimeout(1200);
if ((await page.getByText('client-side validated').count()) !== 0) {
  await fail('dismiss did not close the note');
}
console.log('note dismissed');

console.log('PASS');
await browser.close();
