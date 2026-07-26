import '../env';
import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

type Db = NeonHttpDatabase<typeof schema>;

/**
 * Neon over HTTP: each query is a fetch, so constructing the client never
 * connects. Construction is deferred to first use because on Cloudflare
 * Workers process.env is only populated once a request context exists —
 * module scope runs too early. The placeholder keeps schema tooling
 * (auth:generate, drizzle-kit generate) working without env; the Node
 * entrypoint refuses to start when DATABASE_URL is missing, so the
 * placeholder never serves.
 */
let real: Db | null = null;

function create(): Db {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://placeholder:placeholder@placeholder.invalid/placeholder';
  return drizzle(neon(url), { schema });
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    real ??= create();
    const value = Reflect.get(real as object, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
