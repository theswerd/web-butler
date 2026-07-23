/**
 * The page-extension authoring skill, written to every sandbox VM at
 * SKILL_PATH (acp.ts prep step). The briefing tells agents to read it
 * before producing an `extension` outcome; keeping the full contract in a
 * file the agent pulls lazily keeps the per-turn envelope small while the
 * contract itself stays as specific as it needs to be.
 */

import { WORKSPACE_DIR } from './vm-paths';

export const SKILL_PATH = `${WORKSPACE_DIR}/skills/page-extension/SKILL.md`;

export const EXTENSION_SKILL = `# Writing a page extension

A page extension is a persistent modification to one or more websites. Your script is stored and re-injected on every future visit to matching pages, until the user disables or deletes it. Write it against the page HTML snapshot in the message envelope. Follow this contract exactly; scripts that break it are rejected.

## The outcome

Declare it in your outcomes file as:

{
  "outcomes": [{
    "type": "extension",
    "action": "create",
    "name": "Hide YouTube Shorts",
    "description": "Removes the Shorts shelf and sidebar entry everywhere on YouTube.",
    "urlPatterns": ["*://*.youtube.com/*"],
    "stage": "document_idle",
    "script": "<the full script source>"
  }]
}

- "action": "create" for a new extension. To change an existing one (they are listed in the envelope under "Installed extensions"), use "update" with its "id" and include ALL fields again (the script is replaced whole, not patched). To remove one, use "delete" with its "id"; other fields can repeat the stored values.
- Updating or merging starts from the CURRENT source: every installed extension's script is on your disk at the Source path listed in the envelope — read it first, never rewrite from memory. To merge several extensions into one, a single outcomes file carries one "update" for the survivor (script covering the combined behavior, urlPatterns the union) plus one "delete" per absorbed extension. This is the only case where the outcomes array holds more than one entry.
- "name": short, imperative, user-facing. "description": one sentence, user-facing.
- "urlPatterns": Chrome match patterns. "*://*.youtube.com/*" is every page on youtube.com and subdomains over http/https. Extensions can span sites: ["*://*.reddit.com/*", "*://*.twitter.com/*"]. Prefer the narrowest pattern that covers the request; use path suffixes like "*://github.com/*/pulls*" when it is page-specific.
- "stage": when the script first runs. "document_idle" (default, page settled) unless you must act before the page renders: "document_start" runs before the DOM exists (style-only changes), "document_end" at DOMContentLoaded.

## The script

One IIFE, one call to \`webButler.register\`, nothing else at the top level:

(() => {
  webButler.register({
    apply(page) {
      // make the change
    },
    remove() {
      // undo anything you did WITHOUT the page helpers
    },
    check(page) {
      // self-diagnosis: return true when healthy, or a short string
      // describing what broke, e.g. 'no element matches nav.sidebar'
      return document.querySelector('nav.sidebar') ? true : 'no element matches nav.sidebar';
    },
  });
})();

Rules:

1. \`apply(page)\` MUST be idempotent. It runs again after single-page-app navigations, so guard against double-application (the page helpers are safe to re-call; hand-rolled DOM insertions need an existence check first).
2. Everything visible must be undoable. Prefer the \`page\` helpers — the runtime tracks and reverts them automatically when the extension is disabled. \`remove()\` only needs to undo what you did directly.
3. Hide, don't delete, nodes owned by the page's framework (React/Vue re-create deleted nodes and can crash on missing ones). \`page.hide(el)\` is the right tool.
4. Network requests go through \`page.fetch\` (below), never the page's own \`fetch\`/\`XMLHttpRequest\` — those are subject to the site's CSP and CORS and will often be blocked. No storage (localStorage/cookies/IndexedDB), no globals, no timers that outlive a navigation, no listening on events you don't need.
5. Prefer resilient selectors: semantic attributes (aria-label, title, data-*), stable ids, or structural anchors — not generated class names like "css-1x2y3z" which change on every deploy.
6. Keep it small. A page extension is a scalpel, not an app.
7. ALWAYS include \`check(page)\`. Sites redesign; your extension must know when that broke it. The runtime calls check a moment after apply settles (and again after SPA navigations): return \`true\` when the things you rely on are present and your change took effect; return a short specific string otherwise ("no element matches [aria-label=Shorts]"). A thrown apply also counts as broken. Broken reports surface to the user with an offer to have you repair the extension, and your diagnosis string is the clue the repair starts from — make it name the missing anchor, not just say "failed". A page where the target legitimately never appears (e.g. no cookie banner today) is NOT broken; only report a problem when the page structure contradicts your assumptions.
8. The "description" doubles as the repair spec. State the INTENT (what the user wanted, on which parts of which pages), not the mechanism — a future repair rewrites the script from the description alone, so "Removes the Shorts shelf and sidebar entry on YouTube" repairs well; "Hides #shorts-container" does not.

## The page helpers

\`apply\` receives \`page\`:

- \`page.addStyle(cssText)\` — inject a stylesheet. The best tool for hiding/restyle jobs: survives re-renders with zero re-application work. Reverted automatically on disable.
- \`page.hide(el)\` — hide an element (display:none, tracked). Restored automatically on disable.
- \`page.insert(html, anchor, position?)\` — insert new markup. \`position\` is an insertAdjacentHTML position relative to \`anchor\` ("beforebegin" | "afterbegin" | "beforeend" | "afterend", default "beforeend"). Returns the created element. Removed automatically on disable. Re-check existence in apply before inserting again.
- \`page.mark(el)\` — adopt an element you created by hand so the runtime removes it on disable.
- \`page.onNavigate(cb)\` — called after every SPA URL change (the runtime also re-calls \`apply\`; only use this when you need the new URL specifically).
- \`page.fetch(url, options?)\` — a cross-origin fetch that runs in the extension's background, so it is NOT bound by the page's CSP or CORS, and by default sends the target site's cookies (so calling the site's own API acts as the logged-in user; pass \`{ credentials: 'omit' }\` to opt out). Returns a fetch-like Response with async \`.json()\` / \`.text()\`. \`options\` takes \`method\`, \`headers\`, \`body\` (a string). This is how an extension pulls live data.

## Data-driven extensions

Beyond hiding and restyling, an extension can add real functionality: a button that calls an API and shows the result, a panel of live data the page never displayed, an inline field the site was missing. The shape is always: build UI with \`page.insert\`, wire a handler that calls \`page.fetch\`, render what comes back.

To do this you need to know the API. That is what browser control's investigation step is for (see the browser-control skill): drive the tab, run \`browser network\` to read the exact endpoints, methods, and payloads the page uses, then write an extension that calls the same endpoint via \`page.fetch\`. Learn the contract from real traffic; do not guess endpoint shapes.

Example — a button that fetches and shows a count:

(() => {
  webButler.register({
    apply(page) {
      if (document.querySelector('[data-web-butler-ext] .wb-count')) return; // idempotent
      const box = page.insert('<div><button class="wb-btn">Load stats</button><span class="wb-count"></span></div>', document.querySelector('header'));
      box.querySelector('.wb-btn').addEventListener('click', async () => {
        const res = await page.fetch('https://api.example.com/stats');
        const data = await res.json();
        box.querySelector('.wb-count').textContent = data.total + ' items';
      });
    },
    check(page) {
      return document.querySelector('header') ? true : 'no header to anchor the button to';
    },
  });
})();

Rules still apply: idempotent apply, resilient selectors, everything undoable (UI via \`page.insert\` reverts automatically). Keep fetches to what the feature needs — no polling loops or background chatter.

## Checklist before you write the outcome

- Does apply survive being called twice in a row? (SPA navigation will do exactly that.)
- After remove() plus the runtime's automatic reverts, is the page exactly as it was?
- Do the selectors exist in the page HTML snapshot you were given? Will they plausibly exist on OTHER pages matching the URL patterns?
- Is CSS via addStyle enough? (It usually is, and it is the most robust option.)
- Did an extension in the envelope already touch this? Update it instead of stacking a second one.
- Does check() verify your actual anchors, and stay quiet when the target is legitimately absent?
- Does the description restate the user's intent well enough that you could rewrite the script from it alone?
`;
