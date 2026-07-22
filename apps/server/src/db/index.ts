import '../env';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

/**
 * Neon over HTTP: each query is a fetch, so constructing the client never
 * connects. The placeholder keeps schema tooling (auth:generate,
 * drizzle-kit generate) working without env; the server entrypoint refuses
 * to start when DATABASE_URL is missing, so the placeholder never serves.
 */
const url =
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@placeholder.invalid/placeholder';

export const db = drizzle(neon(url), { schema });
