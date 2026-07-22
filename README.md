# Web Butler

A browser extension that puts an AI butler on every page: a compact prompt
pill that answers questions about the page, runs background tasks, writes
long-form reports into the Chrome side panel, and installs persistent
"site extensions" (user scripts) that keep modifying pages across visits.
Agents run as CLIs (Codex, Grok, Claude Code) on a per-user Freestyle
sandbox VM, driven over ACP (Agent Client Protocol) by a local server.

## Layout

| Path             | What it is                                                        |
| ---------------- | ----------------------------------------------------------------- |
| `apps/extension` | The WXT (MV3) extension: content-script shell, background, panel  |
| `apps/server`    | Hono API: auth, Drizzle/Neon DB, Freestyle VMs, ACP bridge        |
| `packages/ui`    | Shared React components (shell, views, prompt) used by both       |
| `apps/storybook` | Component workbench for the UI package                            |
| `scripts`        | Dev loop + Playwright end-to-end checks                           |

## Prerequisites

- Node 20+ and npm
- A [Neon](https://neon.tech) Postgres database (free tier is fine)
- A [Freestyle](https://freestyle.sh) API key (runs the sandbox VMs)
- Chrome, for loading the extension unpacked

## 1. Install

```bash
npm install
```

## 2. Configure and run the server

```bash
cp apps/server/.env.example apps/server/.env
# fill in DATABASE_URL, BETTER_AUTH_SECRET, FREESTYLE_API_KEY
```

Then create the tables and start it:

```bash
cd apps/server
npm run db:migrate     # applies drizzle/ migrations to your Neon DB
cd ../..
npm run server         # http://localhost:8787 (tsx watch)
```

The extension is hardcoded to `http://localhost:8787`
(`apps/extension/lib/server.ts`), so no extension-side config is needed.

Optional but recommended: build a VM snapshot with the agent CLIs and ACP
adapters preinstalled, so first runs don't pay the install cost:

```bash
cd apps/server
npm run snapshot:build          # prints a snapshot id
# put it in .env as FREESTYLE_SNAPSHOT_ID
```

## 3. Run the extension in your own Chrome

The WXT dev server (`npm run dev`) launches an automation-flagged Chromium
that OAuth bot detection dislikes, so for real sign-ins use the secondary
dev loop, which watch-rebuilds a plain production build for your everyday
Chrome:

```bash
npm run dev:chrome
```

Then, once:

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. **Load unpacked** → pick the `chrome-dev` symlink at the repo root
   (it points at `apps/extension/.output/chrome-mv3`; Chrome's file
   picker hides dot-folders, which is why the symlink exists).
3. On the extension's **Details** page, enable **Allow User Scripts** —
   required for site extensions to inject. Onboarding also walks you
   through this and deep-links the exact switch.
4. Optionally set `WEB_BUTLER_EXTENSION_ORIGINS=chrome-extension://<your id>`
   in `apps/server/.env` (the id is shown on the Details page).

The loop stamps `build-id.txt` into the build after every rebuild; the
background script polls it and reloads the extension itself. After it
reloads, refresh the page you're testing on to remount the content script.

### Using it

- Press **⌘E** (configurable) or click the bowtie pill to open the prompt.
- First run walks through onboarding: connect **ChatGPT** (Codex),
  **Grok**, or **Claude** — device-code flows that run the provider's CLI
  login on your sandbox VM. Your subscription, no API keys.
- Ask page questions, delegate background jobs ("research …"), or request
  persistent page changes ("always hide the sidebar here") — those install
  as site extensions you can toggle in the menu.

## Storybook

```bash
npm run storybook      # http://localhost:6006
```

## End-to-end checks

Playwright scripts in `scripts/` load the built extension into a scratch
Chromium profile (auth bypassed with canned fixture answers where needed):

```bash
npm run build
node scripts/state-check.mjs            # run/task/toast state machine
node scripts/onboarding-check.mjs       # onboarding flow
npx tsx scripts/extension-prelude-check.ts  # user-script prelude runtime
```

If Playwright complains about a missing browser:
`npx playwright install chromium`.

## Style isolation notes

- Tailwind utilities use the `webbutler:` prefix; content UI mounts in a
  shadow root via `createShadowRootUi`.
- A Vite plugin renames Tailwind runtime CSS variables `--tw-*` →
  `--web-butler-tw-*` so host-page variables can't leak in.
- Theme tokens are `--webbutler-*`; stable identity attributes and
  view-transition names use the `web-butler-*` namespace.
- `SharedElement` pairs Motion `layoutId` with CSS `view-transition-name`
  for cross-state element continuity.
