// Screenshots of the task activity masthead states — verifying the brand
// row (bowtie + "TASK") is gone and the status badge sits on the title row.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 560 } });

for (const story of ['running', 'settled-done', 'failed']) {
  await page.goto(
    `http://localhost:6006/iframe.html?id=report-taskactivityview--${story}`,
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `/tmp/task-activity-${story}.png` });
  console.log(`shot: /tmp/task-activity-${story}.png`);
}

await browser.close();
