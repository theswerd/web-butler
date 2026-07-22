import './env';
import { Freestyle } from 'freestyle';

let client: Freestyle | null = null;

/**
 * Lazy so the server can boot (and the OpenAPI spec serve) without a
 * Freestyle credential; only /api/init actually needs one. Accepts either
 * a dashboard API key or a CLI access token.
 */
export function getFreestyle(): Freestyle {
  if (client) return client;
  const apiKey = process.env.FREESTYLE_API_KEY;
  const accessToken = process.env.FREESTYLE_ACCESS_TOKEN;
  if (apiKey) client = new Freestyle({ apiKey });
  else if (accessToken) client = new Freestyle({ accessToken });
  else {
    throw new Error(
      'Set FREESTYLE_API_KEY (or FREESTYLE_ACCESS_TOKEN) in apps/server/.env',
    );
  }
  return client;
}
