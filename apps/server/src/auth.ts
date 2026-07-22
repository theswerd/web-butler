import './env';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous, bearer } from 'better-auth/plugins';
import { db } from './db';

/**
 * Origins allowed to talk to the auth endpoints. Unpacked extension ids
 * differ per machine, so every chrome-extension origin is trusted rather
 * than pinning one id; additional origins can come from the environment.
 */
export const trustedOrigins = [
  'http://localhost:8787',
  'chrome-extension://*',
  ...(process.env.WEB_BUTLER_EXTENSION_ORIGINS?.split(',').filter(Boolean) ??
    []),
];

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me',
  database: drizzleAdapter(db, { provider: 'pg' }),
  trustedOrigins,
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
