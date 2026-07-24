import { useRef, useState } from 'react';
import { HiArrowDownTray, HiCheck, HiClipboard } from 'react-icons/hi2';
import { Markdown } from '../Markdown';

/**
 * Full report surface for the Chrome side panel (chrome.sidePanel API).
 * Where the in-page answer card is a glance, this is a document: serious,
 * long-form output — audits, extracted data, drafts — that deserves real
 * estate and survives while you scroll the page it describes.
 *
 * Designed at side-panel width (~360px) but fluid. The side panel entrypoint
 * owns fetching/holding the report; this component just renders it.
 */
export type ReportViewProps = {
  title: string;
  /** One-liner: what this artifact is. */
  description?: string;
  /** e.g. "youtube.com — 4:12 PM" — where and when the report was produced. */
  meta?: string;
  /** Markdown body (GFM: tables, images, task lists). */
  text: string;
  /** A `highlight:` link was clicked — the panel host relays the focus to
      the active tab's shell (the markers live on the page, not here). */
  onHighlightLink?: (id: string) => void;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Print typography for the PDF document. The report's rendered markdown is
 * semantic HTML (react-markdown), so styling tags directly is enough — the
 * panel's utility classes carry no styles into the iframe and simply fall
 * away.
 */
const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 11pt/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a;
  }
  header { border-bottom: 1px solid #d4d4d4; padding-bottom: 10pt; margin-bottom: 14pt; }
  header h1 { font-size: 17pt; line-height: 1.3; margin: 0; }
  header p { margin: 3pt 0 0; color: #555; font-size: 10pt; }
  header .meta { color: #999; font-size: 8.5pt; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 14pt 0 5pt; }
  h1 { font-size: 14pt; } h2 { font-size: 12.5pt; } h3 { font-size: 11.5pt; } h4 { font-size: 11pt; }
  p { margin: 5pt 0; }
  ul, ol { margin: 5pt 0; padding-left: 18pt; }
  li { margin: 2pt 0; }
  code { font: 9.5pt/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2; padding: 0.5pt 3pt; border-radius: 3pt; }
  pre { background: #f6f6f6; border: 1px solid #e4e4e4; border-radius: 4pt; padding: 8pt; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 6pt 0; padding-left: 10pt; border-left: 2pt solid #d4d4d4; color: #555; }
  table { border-collapse: collapse; margin: 8pt 0; width: 100%; font-size: 10pt; }
  th, td { border: 1px solid #d4d4d4; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f6f6f6; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #d4d4d4; margin: 12pt 0; }
  a { color: inherit; }
  /* Keep code blocks and table rows from splitting across pages mid-line. */
  pre, tr, li { break-inside: avoid; }
`;

export function ReportView({
  title,
  description,
  meta,
  text,
  onHighlightLink,
}: ReportViewProps) {
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  /**
   * "Download PDF" = Chrome's print pipeline with Save as PDF: the rendered
   * report is copied into a hidden print-ready iframe (clean document
   * typography, none of the panel chrome) and printed from there. The
   * document title becomes the suggested filename. No PDF library to ship,
   * and the print dialog doubles as a paper option for those who want it.
   */
  const downloadPdf = () => {
    const content = bodyRef.current?.innerHTML ?? '';
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
${description ? `<p>${escapeHtml(description)}</p>` : ''}
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
</header>
${content}
</body>
</html>`;
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        return;
      }
      // The dialog is modal, so afterprint is the safe teardown moment;
      // the timeout clears the frame even where the event never fires.
      win.onafterprint = () => frame.remove();
      window.setTimeout(() => frame.remove(), 60_000);
      win.focus();
      win.print();
    };
    document.body.appendChild(frame);
  };

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col webbutler:bg-[var(--wc-surface-solid)]">
      {/* Masthead: title with the copy/download actions on its line. */}
      <div className="webbutler:shrink-0 webbutler:border-b webbutler:border-[var(--wc-border-hairline)] webbutler:px-4 webbutler:pt-3.5 webbutler:pb-3">
        <div className="webbutler:flex webbutler:items-start webbutler:justify-between webbutler:gap-3">
          <h1 className="webbutler:min-w-0 webbutler:text-[15px] webbutler:leading-snug webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
            {title}
          </h1>
          <div className="webbutler:flex webbutler:shrink-0 webbutler:gap-1">
            <button
              type="button"
              onClick={copy}
              className="webbutler:mt-px webbutler:flex webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-2)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
            >
              {copied ? (
                <>
                  <HiCheck size={11} aria-hidden className="webbutler:text-[var(--wc-selection)]" />
                  Copied
                </>
              ) : (
                <>
                  <HiClipboard size={11} aria-hidden />
                  Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              title="Download as PDF (via the print dialog)"
              className="webbutler:mt-px webbutler:flex webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-2)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
            >
              <HiArrowDownTray size={11} aria-hidden />
              PDF
            </button>
          </div>
        </div>
        {description ? (
          <p className="webbutler:pt-0.5 webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-2)]">
            {description}
          </p>
        ) : null}
        {meta ? (
          <p className="webbutler:pt-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
            {meta}
          </p>
        ) : null}
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:px-4 webbutler:py-3"
      >
        <Markdown text={text} onHighlightLink={onHighlightLink} />
      </div>
    </div>
  );
}
