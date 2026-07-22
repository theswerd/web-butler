import { useState } from 'react';
import { HiCheck, HiClipboard } from 'react-icons/hi2';
import { BowtieMark } from '../shell/BowtieMark';
import { MarkdownLite } from '../MarkdownLite';

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
  /** Markdown-lite body. */
  text: string;
};

export function ReportView({ title, description, meta, text }: ReportViewProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col webbutler:bg-[var(--wc-surface-solid)]">
      {/* Masthead */}
      <div className="webbutler:shrink-0 webbutler:border-b webbutler:border-[var(--wc-border-hairline)] webbutler:px-4 webbutler:pt-3.5 webbutler:pb-3">
        <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:pb-2 webbutler:text-[var(--wc-ink)]">
          <BowtieMark size={13} />
          <span className="webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
            Report
          </span>
          <span className="webbutler:flex-1" />
          <button
            type="button"
            onClick={copy}
            className="webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-2)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
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
        </div>
        <h1 className="webbutler:text-[15px] webbutler:leading-snug webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
          {title}
        </h1>
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
      <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:px-4 webbutler:py-3">
        <MarkdownLite text={text} />
      </div>
    </div>
  );
}
