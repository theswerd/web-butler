/**
 * Loads apps/server/.env (if present) before anything reads process.env.
 * Uses Node's built-in loader — no dotenv dependency. Real deployments set
 * env vars directly and ship no .env file, hence the silent catch.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  // No .env file — rely on the ambient environment.
}
