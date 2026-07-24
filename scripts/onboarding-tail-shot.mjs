// Screenshots of the onboarding tail steps ("One last thing" and "You're
// all set") — verifying the provider logo no longer appears past connect.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
await page.goto(
  'http://localhost:6006/iframe.html?id=shell-onboardingcard--permissions-step',
);
await page.waitForTimeout(1200);

await page.getByRole('button', { name: /Sign in with ChatGPT/ }).click();
// Fake connect resolves in 1.2s, then the card holds on permissions.
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/onboarding-permissions.png' });
console.log('shot: /tmp/onboarding-permissions.png');

await page.getByRole('button', { name: /Open extension settings/ }).click();
// The story flips the switch after 1.5s; the card advances to done.
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/onboarding-done.png' });
console.log('shot: /tmp/onboarding-done.png');

await browser.close();
