/**
 * Chrome match-pattern evaluation, client-side twin of the server's
 * butler.ts version — the Extensions view uses it for its "This page"
 * filter, so it must agree with what the background actually injects.
 */

const MATCH_PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:]+)(\/.*)$/;

/** True if `url` (http/https) is covered by `pattern`. */
export function matchesPattern(pattern: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (pattern === '<all_urls>') return true;

  const match = MATCH_PATTERN.exec(pattern);
  if (!match) return false;
  const [, scheme, host, path] = match;

  if (scheme !== '*' && `${scheme}:` !== parsed.protocol) return false;

  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (parsed.hostname !== base && !parsed.hostname.endsWith(`.${base}`)) {
        return false;
      }
    } else if (parsed.hostname !== host) {
      return false;
    }
  }

  // Path globbing: '*' spans any characters, everything else is literal.
  const pathRegex = new RegExp(
    `^${path.split('*').map(escapeRegExp).join('.*')}$`,
  );
  return pathRegex.test(parsed.pathname + parsed.search);
}

/** True when any of the extension's patterns covers `url`. */
export function matchesAnyPattern(patterns: string[], url: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, url));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
