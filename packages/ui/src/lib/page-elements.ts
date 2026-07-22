/** A page element captured via the picker, referenced in prompt context. */
export type PickedElement = {
  /** Internal chip id (not the DOM id). */
  id: string;
  /** Stable-ish CSS path, resolvable on the current page. */
  selector: string;
  /** Short human label, e.g. 'button.sidebar-btn'. */
  label: string;
  /** Tag name at pick time — part of the fingerprint. */
  tag: string;
  /** Trimmed visible text, for disambiguation in context. */
  text?: string;
  /**
   * outerHTML captured at pick time (size-capped). Keeps the reference
   * useful to the model even after the element is deleted from the page.
   */
  html: string;
};

/** A picked element as it travels with a message: flagged if it's gone. */
export type SelectedElement = PickedElement & { missing: boolean };

/**
 * Where the user was when they sent a message — attached to every prompt
 * and forwarded to the agent verbatim (the server wraps it in the Web
 * Butler envelope). Captured fresh at send time by `capturePageContext`.
 */
export type PageContext = {
  url: string;
  title?: string;
  /** DOM snapshot, scripts/styles stripped and size-capped. */
  html?: string;
  /** Elements the user explicitly referenced via the picker. */
  selection?: SelectedElement[];
};

/**
 * The page snapshot cap. The server rejects >400k; headroom below that so
 * a huge <head> or data-URI images can't push the payload over.
 */
const PAGE_HTML_MAX = 300_000;

/** Nodes that carry no meaning for the model, only bytes. */
const STRIP_SELECTOR =
  'script, style, link[rel="stylesheet"], noscript, template, web-butler';

/**
 * Snapshot the current page for the agent: a deep clone of the live DOM
 * (so it includes client-rendered content) with non-content nodes and the
 * extension's own UI removed, truncated to a size the server accepts.
 */
export function capturePageContext(selection: SelectedElement[]): PageContext {
  let html: string | undefined;
  try {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll(STRIP_SELECTOR)) node.remove();
    html = clone.outerHTML;
    if (html.length > PAGE_HTML_MAX) {
      html =
        html.slice(0, PAGE_HTML_MAX) +
        `<!-- …truncated (${html.length} chars total) -->`;
    }
  } catch {
    // A hostile DOM (or detached document) never blocks sending.
  }
  return {
    url: window.location.href,
    title: document.title || undefined,
    html,
    selection: selection.length > 0 ? selection.slice(0, 20) : undefined,
  };
}

let chipCounter = 0;

function visibleText(el: Element): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  return el.innerText?.trim().replace(/\s+/g, ' ').slice(0, 60) || undefined;
}

/** Selecting a whole section shouldn't ship half the page to the model. */
const HTML_SNAPSHOT_MAX = 4000;

function htmlSnapshot(el: Element): string {
  const html = el.outerHTML;
  if (html.length <= HTML_SNAPSHOT_MAX) return html;
  return `${html.slice(0, HTML_SNAPSHOT_MAX)}<!-- …truncated (${html.length} chars total) -->`;
}

/** Short human label, e.g. 'button.sidebar-btn' — cheap, safe to call on hover. */
export function elementLabel(el: Element): string {
  let label = el.tagName.toLowerCase();
  if (el.id) {
    label += `#${el.id}`;
  } else {
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length > 0) label += `.${classes.join('.')}`;
  }
  return label;
}

export function pickElement(el: Element): PickedElement {
  const tag = el.tagName.toLowerCase();
  const label = elementLabel(el);

  chipCounter += 1;
  return {
    id: `pick-${Date.now()}-${chipCounter}`,
    selector: cssPath(el),
    label,
    tag,
    text: visibleText(el),
    html: htmlSnapshot(el),
  };
}

/**
 * Resolves a picked reference back to its live element, or null if it's gone.
 *
 * Positional selectors can silently re-match a *different* element after the
 * page re-renders (nth-of-type shifts onto a sibling), so the resolve is
 * verified against the pick-time fingerprint: the tag must match, and if both
 * sides have visible text one must contain the other (containment, not
 * equality, tolerates counters/labels that legitimately update).
 */
export function resolvePickedElement(picked: PickedElement): Element | null {
  let el: Element | null = null;
  try {
    el = document.querySelector(picked.selector);
  } catch {
    return null;
  }
  if (!el) return null;

  if (el.tagName.toLowerCase() !== picked.tag) return null;

  const currentText = visibleText(el);
  if (
    picked.text &&
    currentText &&
    !currentText.includes(picked.text) &&
    !picked.text.includes(currentText)
  ) {
    return null;
  }

  return el;
}

/** Walks up to <html> (or the nearest #id) building a unique CSS path. */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node !== document.documentElement) {
    if (node.id) {
      parts.unshift(`${node.tagName.toLowerCase()}#${CSS.escape(node.id)}`);
      break;
    }
    let selector = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        selector += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(selector);
    node = parent;
  }

  return parts.join(' > ');
}
