import './env';
import { serve } from '@hono/node-server';
import { hasDatabaseUrl } from './db';
import app from './app';

/**
 * Node entrypoint — the local dev server (`npm run dev`). The same Hono
 * app deploys to Cloudflare Workers through src/worker.ts.
 *
 * Note for dev: the VM daemon calls the server back over the public
 * internet, so agent turns need a reachable URL. Set WB_PUBLIC_URL to a
 * tunnel (e.g. cloudflared) pointing at this port, or test turns against
 * the deployed Worker; everything else works straight off localhost.
 */
if (!hasDatabaseUrl()) {
  console.error(
    'DATABASE_URL is not set. Copy apps/server/.env.example to .env and ' +
      'paste your Neon connection string.',
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`web-butler server listening on http://localhost:${info.port}`);
});
