import type { ReactNode } from "react";

/**
 * The row primitives of the menu's list pages. Tasks and Artifacts rows
 * are the same animal — an openable main area (leading mark, up to three
 * truncated text lines), trailing controls, a timestamp — so the skeleton
 * lives here once and the views fill in their own content.
 */

/** "just now", "4m", "2h", "3d" — compact, list-friendly. */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type ListRowProps = {
  /** Makes the row's main area a button (and tints the row on hover). */
  onOpen?: () => void;
  /** Tooltip on the main area — "View task", "Open in side panel". */
  openTitle?: string;
  /** The mark before the text: a status dot, a document icon. */
  leading?: ReactNode;
  title: ReactNode;
  /** Dim the title — rows already seen, nothing new here. */
  muted?: boolean;
  /** Second line: the outcome, the live activity, a description. */
  secondary?: ReactNode;
  /** Third line: the quiet origin — a hostname, report meta. */
  meta?: ReactNode;
  /** Trailing controls (chips, RowIconButtons) and the RowTime. */
  children?: ReactNode;
};

/**
 * One list row. The main area and the trailing controls are separate
 * interactive elements, so the row itself is a plain container (buttons
 * can't nest); `group` lets trailing controls hover-reveal.
 */
export function ListRow({
  onOpen,
  openTitle,
  leading,
  title,
  muted = false,
  secondary,
  meta,
  children,
}: ListRowProps) {
  const Main = onOpen ? "button" : "div";
  return (
    <div
      className={`webbutler:group webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-2 ${
        onOpen
          ? "webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
          : ""
      }`}
    >
      <Main
        {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
        title={onOpen ? openTitle : undefined}
        className={`webbutler:flex webbutler:min-w-0 webbutler:flex-1 webbutler:items-start webbutler:gap-2 webbutler:text-left ${
          onOpen ? "webbutler:cursor-pointer" : ""
        }`}
      >
        {leading}
        {/* Spans (not p/div): the main area is often a button, and only
            phrasing content is valid inside one. */}
        <span className="webbutler:min-w-0 webbutler:flex-1">
          <span
            className={`webbutler:block webbutler:truncate webbutler:text-[12px] webbutler:leading-4 ${
              muted
                ? "webbutler:text-[var(--wc-text-2)]"
                : "webbutler:font-medium webbutler:text-[var(--wc-ink)]"
            }`}
          >
            {title}
          </span>
          {secondary ? (
            <span className="webbutler:block webbutler:truncate webbutler:pt-px webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
              {secondary}
            </span>
          ) : null}
          {meta ? (
            <span className="webbutler:block webbutler:truncate webbutler:pt-px webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
              {meta}
            </span>
          ) : null}
        </span>
      </Main>
      {children}
    </div>
  );
}

/** A row's small circular icon control (retry, trash). `hoverReveal`
    fades it in on row hover, but its slot is always reserved so the
    timestamps stay on one axis whether or not the pointer is there. */
export function RowIconButton({
  title,
  ariaLabel,
  onClick,
  hoverReveal = false,
  children,
}: {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  hoverReveal?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:transition-all webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] ${
        hoverReveal
          ? "webbutler:opacity-0 webbutler:group-hover:opacity-100 webbutler:focus-visible:opacity-100"
          : ""
      }`}
    >
      {children}
    </button>
  );
}

/** The row's right-aligned timestamp, top-aligned with the title line. */
export function RowTime({ children }: { children: ReactNode }) {
  return (
    <span className="webbutler:shrink-0 webbutler:pt-[3px] webbutler:text-[10px] webbutler:tabular-nums webbutler:text-[var(--wc-text-4)]">
      {children}
    </span>
  );
}
