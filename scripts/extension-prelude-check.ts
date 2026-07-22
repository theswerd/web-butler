// Behavior check for the site-extension runtime prelude (lib/user-scripts):
// executes a generated script in a real page and verifies the contract —
// apply takes effect, re-execution stays idempotent (replaces, not stacks),
// and runtime.remove() reverts the page to untouched.
//
//   npx tsx scripts/extension-prelude-check.ts     (from repo root)
import { chromium } from 'playwright';
import type { SiteExtension } from '@web-butler/ui/shell';

// Import the real code generator — the exact string Chrome would register.
import { buildCode } from '../apps/extension/lib/user-scripts';

const ext: SiteExtension = {
  id: 'check-1',
  name: 'Check extension',
  description: 'test',
  urlPatterns: ['*://example.com/*'],
  stage: 'document_idle',
  enabled: true,
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  script: `
    webButler.register({
      apply(page) {
        page.addStyle('h1 { color: rgb(255, 0, 0) !important; }');
        const h1 = document.querySelector('h1');
        if (h1) page.hide(h1.nextElementSibling ? h1.nextElementSibling : h1);
        if (!document.querySelector('[data-check-banner]')) {
          page.insert('<div data-check-banner>BUTLER WAS HERE</div>', document.body, 'afterbegin');
        }
      },
      remove() {},
    });
  `,
};

const code = buildCode(ext);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com');

const fail = (label: string) => {
  console.error(`FAIL: ${label}`);
  process.exitCode = 1;
};

// 1. Apply.
await page.evaluate(code);
const applied = await page.evaluate(() => ({
  banner: document.querySelectorAll('[data-check-banner]').length,
  style: document.querySelectorAll('style[data-web-butler-ext="check-1"]').length,
  hidden: document.querySelectorAll('[data-web-butler-hidden="check-1"]').length,
  h1Color: getComputedStyle(document.querySelector('h1')!).color,
}));
if (applied.banner !== 1) fail(`banner count ${applied.banner}`);
if (applied.style !== 1) fail(`style count ${applied.style}`);
if (applied.hidden !== 1) fail(`hidden count ${applied.hidden}`);
if (applied.h1Color !== 'rgb(255, 0, 0)') fail(`h1 color ${applied.h1Color}`);
console.log('apply:', applied);

// 2. Re-execute (what an update / SPA re-apply does) — must not stack.
await page.evaluate(code);
const reapplied = await page.evaluate(() => ({
  banner: document.querySelectorAll('[data-check-banner]').length,
  style: document.querySelectorAll('style[data-web-butler-ext="check-1"]').length,
}));
if (reapplied.banner !== 1) fail(`banner stacked to ${reapplied.banner}`);
if (reapplied.style !== 1) fail(`style stacked to ${reapplied.style}`);
console.log('re-execute:', reapplied);

// 3. Revert.
await page.evaluate(
  `globalThis.__webButlerRuntime && globalThis.__webButlerRuntime.remove("check-1");`,
);
const reverted = await page.evaluate(() => ({
  banner: document.querySelectorAll('[data-check-banner]').length,
  style: document.querySelectorAll('style[data-web-butler-ext="check-1"]').length,
  hidden: document.querySelectorAll('[data-web-butler-hidden="check-1"]').length,
  h1Color: getComputedStyle(document.querySelector('h1')!).color,
}));
if (reverted.banner !== 0) fail(`banner survived revert`);
if (reverted.style !== 0) fail(`style survived revert`);
if (reverted.hidden !== 0) fail(`hidden survived revert`);
if (reverted.h1Color === 'rgb(255, 0, 0)') fail(`h1 still red after revert`);
console.log('revert:', reverted);

// --- 4. Self-diagnosis reports ----------------------------------------------
// The prelude reports health through chrome.runtime.sendMessage (available
// in the USER_SCRIPT world once the background configures messaging). Shim
// it here and verify all three verdict paths.
// A string, not a function: tsx's esbuild pass injects a __name helper
// into serialized closures, which doesn't exist inside the page.
await page.evaluate(`
  globalThis.__reports = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        globalThis.__reports.push(message);
        return Promise.resolve();
      },
    },
  };
`);

const variant = (id: string, script: string): string =>
  buildCode({ ...ext, id, script });

// Healthy: check() returns true → 'ok'. Broken check: returns a string.
// Broken apply: throws. (2s diagnosis delay in the runtime.)
await page.evaluate(
  variant(
    'health-ok',
    `webButler.register({ apply() {}, remove() {},
       check() { return document.querySelector('h1') ? true : 'no h1'; } });`,
  ),
);
await page.evaluate(
  variant(
    'health-gone',
    `webButler.register({ apply() {}, remove() {},
       check() { return document.querySelector('.does-not-exist') ? true : 'no element matches .does-not-exist'; } });`,
  ),
);
await page.evaluate(
  variant(
    'health-throw',
    `webButler.register({ apply() { throw new Error('anchor missing'); }, remove() {} });`,
  ),
);
await page.waitForTimeout(2600);
type Report = { webButlerHealth: { id: string; status: string; reason?: string } };
const reports = (await page.evaluate('globalThis.__reports')) as Report[];
const byId = new Map(reports.map((r) => [r.webButlerHealth.id, r.webButlerHealth]));
if (byId.get('health-ok')?.status !== 'ok') fail('healthy script not ok');
if (byId.get('health-gone')?.status !== 'broken') fail('failed check not broken');
if (byId.get('health-gone')?.reason !== 'no element matches .does-not-exist') {
  fail(`check reason lost: ${byId.get('health-gone')?.reason}`);
}
if (byId.get('health-throw')?.status !== 'broken') fail('thrown apply not broken');
if (byId.get('health-throw')?.reason !== 'anchor missing') {
  fail(`throw reason lost: ${byId.get('health-throw')?.reason}`);
}
console.log('health reports:', [...byId.values()]);

await browser.close();
console.log(process.exitCode ? 'PRELUDE CHECK FAILED' : 'PRELUDE CHECK PASSED');
