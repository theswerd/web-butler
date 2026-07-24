/**
 * Compact page digest for starter-prompt generation: what a person would
 * skim to answer "what is this page and what would I ask about it" —
 * description, headings, leading prose. Deliberately NOT the full HTML
 * snapshot the agent gets with real turns: starters are decoration, so
 * the request must stay small and cheap to produce on every page.
 */

const SIGNAL_MAX = 3500;
const PROSE_MAX = 1500;

/**
 * Ad-shaped page furniture. Deliberately conservative selectors — the
 * count feeds a suggestion ("hide the ads here"), so a false positive on
 * a clean page would produce a nonsense chip. Sponsored-content classes
 * and the big ad-network fingerprints, not every `class*="ad"`.
 */
const AD_SELECTOR = [
  'ins.adsbygoogle',
  '[id^="google_ads"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="adsystem"]',
  'iframe[src*="adservice"]',
  '[class*="sponsored"]',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[aria-label*="advertisement" i]',
  '[id^="ad-slot"]',
  '[class*="advert"]',
].join(', ');

/** How cluttered the page is — 0 on clean pages, capped cheaply. */
function adCount(doc: Document): number {
  let count = 0;
  for (const el of doc.querySelectorAll(AD_SELECTOR)) {
    if (!usable(el)) continue;
    count += 1;
    if (count >= 30) break;
  }
  return count;
}

/** Visible and outside our own shadow host. */
function usable(el: Element): boolean {
  if (el.closest('web-butler')) return false;
  return (el as HTMLElement).checkVisibility?.() ?? true;
}

export function capturePageSignal(doc: Document = document): string {
  const parts: string[] = [];

  try {
    const description =
      doc
        .querySelector('meta[name="description"], meta[property="og:description"]')
        ?.getAttribute('content')
        ?.trim() ?? '';
    if (description) parts.push(description.slice(0, 400));

    const headings: string[] = [];
    for (const heading of doc.querySelectorAll('h1, h2, h3')) {
      if (headings.length >= 8) break;
      if (!usable(heading)) continue;
      const text = heading.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      if (text && text.length <= 200) headings.push(text);
    }
    if (headings.length > 0) parts.push(headings.join('\n'));

    let prose = '';
    for (const p of doc.querySelectorAll('p, li')) {
      if (prose.length >= PROSE_MAX) break;
      if (!usable(p)) continue;
      const text = p.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      if (text.length > 30) prose += `${text}\n`;
    }
    if (prose) parts.push(prose.slice(0, PROSE_MAX));

    // Clutter is invisible in description/headings/prose, but it's the
    // best "modify this page" opening there is (hide the ads, clean up
    // the layout) — so tell the model when the page is ad-heavy.
    const ads = adCount(doc);
    if (ads >= 3) {
      parts.push(`Noise: about ${ads} ad/sponsored slots on this page`);
    }
  } catch {
    // A hostile page's DOM can throw in odd ways; whatever was collected
    // before the throw is still a usable signal.
  }

  return parts.join('\n\n').slice(0, SIGNAL_MAX);
}
