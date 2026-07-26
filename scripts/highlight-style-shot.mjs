/** One-off: screenshot the AgentHighlight restyle-concept stories from the
    static Storybook build (served over HTTP; file:// blocks modules). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = '/Users/ben/Documents/webcontrol/apps/storybook/storybook-static';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.join(dir, url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 660, height: 400 } });
page.on('pageerror', (err) => console.log('pageerror:', err.message));
for (const name of ['corners', 'tag', 'dashed', 'glow', 'classic']) {
  await page.goto(
    `http://localhost:${port}/iframe.html?id=shell-agenthighlight--${name}&viewMode=story`,
  );
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `/tmp/hl-${name}.png` });
  console.log('shot', `/tmp/hl-${name}.png`);
}
await browser.close();
server.close();
console.log('done');
