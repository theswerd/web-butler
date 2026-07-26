import './env';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous, bearer } from 'better-auth/plugins';
import { db } from './db';

/**
 * Origins allowed to talk to the auth endpoints. Unpacked extension ids
 * differ per machine, so every chrome-extension origin is trusted rather
 * than pinning one id; additional origins can come from the environment.
 * A function (not a constant) because on Workers the env is only readable
 * inside a request context.
 */
export function getTrustedOrigins(): string[] {
  return [
    'http://localhost:8787',
    'chrome-extension://*',
    ...(process.env.WEB_BUTLER_EXTENSION_ORIGINS?.split(',').filter(Boolean) ??
      []),
  ];
}

function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
    secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me',
    database: drizzleAdapter(db, { provider: 'pg' }),
    trustedOrigins: getTrustedOrigins(),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      // First run signs the extension in without any account UI; the account
      // can later be claimed by linking a real sign-in method.
      anonymous(),
      // MV3 service workers are awkward with cookie jars — the extension
      // authenticates with the `set-auth-token` header value as a Bearer
      // token instead.
      bearer(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

/** Lazy for the same Workers reason as `db`: env isn't readable until a
    request is in flight, and betterAuth captures its config at creation. */
let real: Auth | null = null;

export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    real ??= createAuth();
    const value = Reflect.get(real as object, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
