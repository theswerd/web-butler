import type { ElementType } from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** `[label](highlight:ID)` — the agent pointing at a page section it
    flagged. Not a real URL scheme; intercepted below and never navigated. */
const HIGHLIGHT_SCHEME = 'highlight:';

/** Pass highlight: hrefs through the sanitizer untouched — the default
    transform strips unknown schemes, which would blank these links before
    the renderer could claim them. Everything else keeps the default rules. */
const urlTransform = (url: string) =>
  url.startsWith(HIGHLIGHT_SCHEME) ? url : defaultUrlTransform(url);

/**
 * Renderer for model prose — the answer card, the side-panel report view,
 * and task activity lines all draw through here. Full CommonMark plus GFM
 * (tables, task lists, strikethrough, autolinks) and images.
 *
 * Raw HTML in the source is NOT rendered (react-markdown's default): this
 * output lands inside arbitrary host pages, so model text stays text.
 *
 * The `components` prop is the extension seam: consumers can override or
 * add per-element renderers, which is where product-specific custom
 * components (charts, action buttons) will plug in later.
 *
 * `highlight:` links render as marker chips instead of anchors: clicking
 * one calls `onHighlightLink` with the highlight's id (the shell scrolls
 * to and focuses that marker). Without a handler the chip still renders —
 * inert — so prose written for the page degrades gracefully elsewhere.
 */
export function Markdown({
  text,
  components,
  onHighlightLink,
}: {
  text: string;
  components?: Components;
  onHighlightLink?: (id: string) => void;
}) {
  // The anchor renderer closes over the handler, so it's built per render.
  // Consumer `a` overrides still apply to ordinary links.
  const anchor: Components['a'] = (props) => {
    const href = props.href ?? '';
    if (href.startsWith(HIGHLIGHT_SCHEME)) {
      const id = href.slice(HIGHLIGHT_SCHEME.length);
      return (
        <button
          type="button"
          onClick={onHighlightLink ? () => onHighlightLink(id) : undefined}
          className={`webbutler:inline-flex webbutler:translate-y-px webbutler:items-baseline webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[#f59e0b]/45 webbutler:bg-[#f59e0b]/10 webbutler:px-1.5 webbutler:py-px webbutler:align-baseline webbutler:text-[11px] webbutler:leading-[1.4] webbutler:font-medium webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 ${
            onHighlightLink
              ? 'webbutler:cursor-pointer webbutler:hover:border-[#f59e0b] webbutler:hover:bg-[#f59e0b]/20'
              : 'webbutler:cursor-default'
          }`}
        >
          <span
            aria-hidden
            className="webbutler:size-1.5 webbutler:shrink-0 webbutler:self-center webbutler:rounded-full webbutler:bg-[#f59e0b]"
          />
          {props.children}
        </button>
      );
    }
    const Base = (components?.a ?? BASE.a) as ElementType;
    return <Base {...props} />;
  };

  return (
    <div className="webbutler:flex webbutler:flex-col webbutler:gap-2 webbutler:text-[12px] webbutler:leading-[1.55] webbutler:text-[var(--wc-text-2)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{ ...BASE, ...components, a: anchor }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Back-compat alias from the hand-rolled days; prefer `Markdown`. */
export const MarkdownLite = Markdown;

/* The wrapper's flex gap spaces the top-level blocks, so these renderers
   carry no vertical margins of their own — nested spacing (lists in lists,
   paragraphs in list items) is handled inline where it occurs. */

const INK = 'webbutler:text-[var(--wc-ink)]';

const BASE: Components = {
  p: (props) => <p className="webbutler:m-0">{props.children}</p>,

  h1: (props) => (
    <h1 className={`webbutler:m-0 webbutler:pt-1 webbutler:text-[15px] webbutler:leading-snug webbutler:font-semibold ${INK}`}>
      {props.children}
    </h1>
  ),
  h2: (props) => (
    <h2 className={`webbutler:m-0 webbutler:pt-1 webbutler:text-[13.5px] webbutler:leading-snug webbutler:font-semibold ${INK}`}>
      {props.children}
    </h2>
  ),
  h3: (props) => (
    <h3 className={`webbutler:m-0 webbutler:pt-0.5 webbutler:text-[12.5px] webbutler:leading-snug webbutler:font-semibold ${INK}`}>
      {props.children}
    </h3>
  ),
  h4: (props) => (
    <h4 className={`webbutler:m-0 webbutler:text-[12px] webbutler:font-semibold ${INK}`}>{props.children}</h4>
  ),
  h5: (props) => (
    <h5 className={`webbutler:m-0 webbutler:text-[12px] webbutler:font-semibold ${INK}`}>{props.children}</h5>
  ),
  h6: (props) => (
    <h6 className="webbutler:m-0 webbutler:text-[11px] webbutler:font-semibold webbutler:tracking-[0.05em] webbutler:text-[var(--wc-text-3)] webbutler:uppercase">
      {props.children}
    </h6>
  ),

  strong: (props) => (
    <strong className={`webbutler:font-semibold ${INK}`}>{props.children}</strong>
  ),
  em: (props) => <em className="webbutler:italic">{props.children}</em>,
  del: (props) => (
    <del className="webbutler:text-[var(--wc-text-4)] webbutler:line-through">{props.children}</del>
  ),

  a: (props) => (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className={`webbutler:underline webbutler:decoration-[var(--wc-border-strong)] webbutler:underline-offset-2 webbutler:transition-colors webbutler:hover:decoration-current ${INK}`}
    >
      {props.children}
    </a>
  ),

  /* Lists. `space-y` rather than flex: list items must stay display
     list-item for markers to draw. Nested lists indent and tighten. */
  ul: (props) => (
    <ul className="webbutler:m-0 webbutler:list-disc webbutler:space-y-1 webbutler:pl-4 webbutler:marker:text-[var(--wc-text-4)] webbutler:[&_ul]:mt-1 webbutler:[&_ol]:mt-1">
      {props.children}
    </ul>
  ),
  ol: (props) => (
    <ol className="webbutler:m-0 webbutler:list-decimal webbutler:space-y-1 webbutler:pl-4 webbutler:marker:text-[var(--wc-text-4)] webbutler:[&_ul]:mt-1 webbutler:[&_ol]:mt-1">
      {props.children}
    </ol>
  ),
  li: (props) => (
    // Task-list items carry their own checkbox; drop the disc marker.
    <li
      className={`webbutler:pl-0.5 webbutler:[&>p]:m-0 ${
        String(props.className ?? '').includes('task-list-item')
          ? 'webbutler:list-none'
          : ''
      }`}
    >
      {props.children}
    </li>
  ),
  /* GFM task-list checkboxes: read-only state markers. */
  input: (props) =>
    props.type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={props.checked === true}
        readOnly
        disabled
        className="webbutler:mr-1.5 webbutler:size-[11px] webbutler:translate-y-px webbutler:accent-[var(--wc-accent)]"
      />
    ) : null,

  code: (props) => (
    <code className={`webbutler:rounded webbutler:bg-[var(--wc-hover-2)] webbutler:px-1 webbutler:py-px webbutler:font-mono webbutler:text-[11px] ${INK}`}>
      {props.children}
    </code>
  ),
  /* Fences: the block chrome lives here; the inline look of `code` above
     is neutralized for the code element it wraps. */
  pre: (props) => (
    <pre className={`webbutler:m-0 webbutler:overflow-x-auto webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)] webbutler:px-2.5 webbutler:py-2 webbutler:font-mono webbutler:text-[11px] webbutler:leading-[1.5] ${INK} webbutler:[&_code]:rounded-none webbutler:[&_code]:bg-transparent webbutler:[&_code]:p-0`}>
      {props.children}
    </pre>
  ),

  blockquote: (props) => (
    <blockquote className="webbutler:m-0 webbutler:border-l-2 webbutler:border-[var(--wc-border)] webbutler:pl-2.5 webbutler:text-[var(--wc-text-3)] webbutler:[&>p]:m-0">
      {props.children}
    </blockquote>
  ),

  hr: () => <hr className="webbutler:my-1 webbutler:border-t webbutler:border-[var(--wc-border-hairline)]" />,

  /* Tables (GFM). The wrapper scrolls so a wide table never stretches the
     answer card or report column. */
  table: (props) => (
    <div className="webbutler:overflow-x-auto webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-hairline)]">
      <table className="webbutler:w-full webbutler:border-collapse webbutler:text-[11.5px]">
        {props.children}
      </table>
    </div>
  ),
  thead: (props) => (
    <thead className="webbutler:bg-[var(--wc-hover-1)]">{props.children}</thead>
  ),
  th: (props) => (
    <th
      style={{ textAlign: props.style?.textAlign }}
      className={`webbutler:border-b webbutler:border-[var(--wc-border-hairline)] webbutler:px-2.5 webbutler:py-1.5 webbutler:text-left webbutler:font-semibold webbutler:whitespace-nowrap ${INK}`}
    >
      {props.children}
    </th>
  ),
  td: (props) => (
    <td
      style={{ textAlign: props.style?.textAlign }}
      className="webbutler:border-b webbutler:border-[var(--wc-border-soft)] webbutler:px-2.5 webbutler:py-1.5 webbutler:align-top webbutler:last:border-b-0"
    >
      {props.children}
    </td>
  ),
  tr: (props) => (
    <tr className="webbutler:last:[&>td]:border-b-0">{props.children}</tr>
  ),

  img: (props) => (
    <img
      src={props.src}
      alt={props.alt ?? ''}
      loading="lazy"
      decoding="async"
      className="webbutler:my-0.5 webbutler:h-auto webbutler:max-w-full webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-hairline)]"
    />
  ),
};
