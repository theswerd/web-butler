// Cloudflare Pages advanced-mode worker for butler.swerdlow.dev.
//
// The API lives in its own Worker (web-butler-api), but swerdlow.dev's
// DNS is hosted on Vercel, so a Workers custom domain can't attach to
// this hostname — only the Pages project can (external-CNAME domains are
// a Pages-only feature). This shim gives the API a presence on the
// public domain anyway: /api/* (plus the health/docs endpoints) proxies
// to the API Worker; everything else falls through to the static site.
//
// Vite copies public/ into dist, so this deploys with the homepage.

const API_ORIGIN = 'https://web-butler-api.swerdlowbenjamin.workers.dev';

const PROXIED = /^\/(api(\/|$)|health$|docs$|openapi$)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (PROXIED.test(url.pathname)) {
      // Request-as-init carries method, headers, and body through intact.
      return fetch(API_ORIGIN + url.pathname + url.search, request);
    }
    return env.ASSETS.fetch(request);
  },
};
