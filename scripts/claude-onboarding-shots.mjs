// Screenshots of the new 3-provider onboarding + Claude paste-back flow.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 480 } });

const shot = async (story, name, actions) => {
  await page.goto(`http://localhost:6007/iframe.html?id=${story}&viewMode=story`);
  await page.waitForTimeout(800);
  if (actions) await actions();
  await page.screenshot({ path: `/tmp/${name}.png` });
  console.log(name, 'saved');
};

// Welcome: the vertical stack of three providers.
await shot('shell-onboardingcard--live-demo', 'onboarding-welcome-stack');

// Claude flow: pending with the paste box.
await shot('shell-onboardingcard--claude-code-paste', 'onboarding-claude-paste');

// Claude flow: code typed, then submitted (verifying), then done.
await shot(
  'shell-onboardingcard--claude-code-paste',
  'onboarding-claude-verifying',
  async () => {
    await page.fill('input[placeholder="Paste your code"]', 'ac_0aB3xYz9…');
    await page.screenshot({ path: '/tmp/onboarding-claude-typed.png' });
    console.log('onboarding-claude-typed saved');
    await page.click('button:has-text("Connect")');
    await page.waitForTimeout(600);
  },
);

// ProvidersView: Claude row pending with inline paste box.
await shot(
  'shell-providersview--default',
  'providers-claude-row',
  async () => {
    // Click Claude's Connect button, wait for pending.
    const rows = page.locator('text=Claude');
    await rows.first().hover();
    const connect = page
      .locator('div', { hasText: 'Claude' })
      .locator('button', { hasText: 'Connect' });
    await connect.last().click();
    await page.waitForTimeout(1400);
  },
);

await browser.close();
