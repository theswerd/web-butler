import app from './app';

/**
 * Cloudflare Workers entrypoint (see wrangler.jsonc). The app is fully
 * stateless — turns and browser actions live in Postgres, agent processes
 * live on the user's Freestyle VM under the daemon — so the free tier's
 * request-scoped model fits exactly. nodejs_compat surfaces the env
 * bindings through process.env, which the lazy db/auth constructors read
 * on first use inside a request.
 */
export default app;
