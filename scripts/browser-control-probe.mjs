// Probe: browser-control's page-side scripts and key parsing, against a
// real DOM. Bundles the actual module (wxt/browser stubbed) and checks:
//   - SNAPSHOT_JS still tags a <select> with a ref
//   - selectOptionJs picks by exact label, value, and substring; fires the
//     page's input/change handlers; lists options on a miss; refuses
//     non-selects
//   - resolveKey handles named keys, single chars, and rejects junk
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const src = path.resolve(root, 'apps/extension/lib/browser-control.ts');
const stub = path.resolve(dir, 'wxt-browser-stub.mjs');
const bundle = execSync(
  `npx esbuild ${src} --bundle --format=iife --global-name=bc ` +
    `--alias:wxt/browser=${stub} --alias:@web-butler/ui/shell=${stub}`,
  { cwd: root, encoding: 'utf8' },
);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.setContent(`<!doctype html>
  <select id="state">
    <option value="">Choose…</option>
    <option value="CA">California</option>
    <option value="NY">New York</option>
  </select>
  <button id="go">Go</button>
  <script>
    window.fired = [];
    document.getElementById('state').addEventListener('change',
      (e) => window.fired.push('change:' + e.target.value));
    document.getElementById('state').addEventListener('input',
      () => window.fired.push('input'));
  </script>`);
await page.addScriptTag({ content: bundle });

// Snapshot must tag the select and the button with refs.
const els = await page.evaluate('eval(window.bc.SNAPSHOT_JS)');
const selectRef = els.find((el) => el.role === 'select')?.ref;
const buttonRef = els.find((el) => el.role === 'button')?.ref;
check('snapshot tags the <select>', Boolean(selectRef), JSON.stringify(els));

const pick = (ref, option) =>
  page.evaluate(`eval(window.bc.selectOptionJs(${JSON.stringify(ref)}, ${JSON.stringify(option)}))`);

// Exact label (case-insensitive).
let res = await pick(selectRef, 'california');
check('picks by label', res.ok && res.picked === 'California', JSON.stringify(res));
const fired = await page.evaluate('window.fired');
check(
  'fires input+change on the page',
  fired.includes('input') && fired.includes('change:CA'),
  JSON.stringify(fired),
);

// By value.
res = await pick(selectRef, 'NY');
check('picks by value', res.ok && res.picked === 'New York', JSON.stringify(res));

// Substring.
res = await pick(selectRef, 'york');
check('picks by substring', res.ok && res.picked === 'New York', JSON.stringify(res));

// Miss lists the options.
res = await pick(selectRef, 'Texas');
check(
  'miss lists options',
  !res.ok && res.options?.includes('California'),
  JSON.stringify(res),
);

// Non-select is refused.
res = await pick(buttonRef, 'anything');
check('refuses non-selects', !res.ok && res.notSelect === true, JSON.stringify(res));

// Key resolution (pure — runs in the page only because the bundle is there).
const key = (name) => page.evaluate(`window.bc.resolveKey(${JSON.stringify(name)})`);
const enter = await key('enter');
check('named key (enter)', enter?.key === 'Enter' && enter?.keyCode === 13);
const a = await key('a');
check('single char (a)', a?.code === 'KeyA' && a?.keyCode === 65 && a?.text === 'a');
const seven = await key('7');
check('digit (7)', seven?.code === 'Digit7');
const junk = await key('NotAKey');
check('junk rejected', junk === null);

await browser.close();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS');
