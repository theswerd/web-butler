// Secondary dev loop for using the extension in your NORMAL Chrome.
//
// The wxt dev server launches its own automation-flagged Chromium, which
// OAuth providers' bot detection dislikes. This loop instead watch-rebuilds
// a plain production build into apps/extension/.output/chrome-mv3, which you
// load unpacked in your everyday browser (chrome://extensions → Developer
// mode → Load unpacked). Each successful build stamps build-id.txt; the
// background script polls that stamp and calls runtime.reload() when it
// changes, so the extension refreshes itself. Refresh the page to remount
// the content script after a reload.
//
//   npm run dev:chrome
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'apps/extension/.output/chrome-mv3');

const WATCHED = [
  'packages/ui/src',
  'apps/extension/entrypoints',
  'apps/extension/components',
  'apps/extension/lib',
  'apps/extension/public',
  'apps/extension/wxt.config.ts',
];

const log = (message) =>
  console.log(`[watch-build ${new Date().toLocaleTimeString()}] ${message}`);

let building = false;
let dirty = false;

function build() {
  if (building) {
    dirty = true; // a change landed mid-build; go again after
    return;
  }
  building = true;
  const startedAt = Date.now();
  const child = spawn('npm', ['run', 'build', '-w', '@web-butler/extension'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  child.on('exit', (code) => {
    building = false;
    if (code === 0) {
      // The stamp the background script polls to know it should reload.
      writeFileSync(path.join(outDir, 'build-id.txt'), randomUUID());
      log(`built in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — Chrome reloads itself`);
    } else {
      log(`build FAILED (exit ${code})`);
    }
    if (dirty) {
      dirty = false;
      build();
    }
  });
}

let debounce;
for (const target of WATCHED) {
  const absolute = path.join(root, target);
  if (!existsSync(absolute)) continue;
  watch(absolute, { recursive: true }, (_event, file) => {
    if (file && /\.(tsx?|css|html|json|svg|png)$/.test(file)) {
      clearTimeout(debounce);
      debounce = setTimeout(build, 300);
    }
  });
}

log(`watching ${WATCHED.length} paths; building now…`);
// Chrome's file picker hides dot-folders like .output; a visible symlink
// at the repo root gives "Load unpacked" something it can see.
const link = path.join(root, 'chrome-dev');
try {
  if (!existsSync(link)) {
    symlinkSync(path.relative(root, outDir), link);
  }
  log(`load unpacked from: ${link}`);
} catch {
  log(`load unpacked from: ${outDir} (press Cmd+Shift+. in the picker)`);
}
build();
