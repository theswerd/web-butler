/**
 * Single schema entrypoint for drizzle-kit and the app. Better Auth's
 * tables are generated into auth-schema.ts (`npm run auth:generate`);
 * hand-written app tables get their own files re-exported here.
 */
export * from './auth-schema';
export * from './app-schema';
