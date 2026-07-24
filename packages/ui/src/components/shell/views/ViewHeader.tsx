import { useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { HiMagnifyingGlass, HiXMark } from "react-icons/hi2";

/**
 * The shared chrome of every menu page. All five views (Tasks, Artifacts,
 * Extensions, Providers, Settings) are the same page at heart — a header
 * bar, a scrolling body, an empty state — so that shape lives here once:
 *
 *   <ViewFrame label="Tasks" actions={<HeaderAction …/>}>
 *     <ViewBody>…rows…</ViewBody>          // or, when there's nothing:
 *     <ViewEmpty icon={HiOutlineClock}>…</ViewEmpty>
 *   </ViewFrame>
 *
 * Row-level primitives (ListRow, RowTime, …) live in ListRow.tsx; the
 * Providers/Settings keyboard model lives in useRovingRows.ts.
 */

/**
 * The standard top bar of every menu page: a quiet uppercase label on the
 * left, page-level actions (clear buttons, filters) on the right. Kept
 * outside each page's scroll area so the actions never scroll away.
 */
export function ViewHeader({
  label,
  children,
}: {
  label: string;
  /** Right-aligned page actions. */
  children?: ReactNode;
}) {
  return (
    <div className="webbutler:flex webbutler:shrink-0 webbutler:items-center webbutler:gap-1 webbutler:px-3 webbutler:pt-2 webbutler:pb-0.5">
      <span className="webbutler:flex-1 webbutler:text-[10px] webbutler:font-medium webbutler:tracking-wide webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/** The page itself: full-height column, header on top, content below. */
export function ViewFrame({
  label,
  actions,
  children,
}: {
  label: string;
  /** The header's right side — HeaderActions, search, filter tabs. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
      <ViewHeader label={label}>{actions}</ViewHeader>
      {children}
    </div>
  );
}

/** The page's scrolling list area, under the (pinned) header. */
export function ViewBody({ children }: { children: ReactNode }) {
  return (
    <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:pb-1.5 webbutler:pt-0.5">
      {children}
    </div>
  );
}

/** The nothing-here state: a quiet icon and one sentence, centered in
    whatever height the frame has left. */
export function ViewEmpty({
  icon: Icon,
  children,
}: {
  icon: IconType;
  children: ReactNode;
}) {
  return (
    <div className="webbutler:flex webbutler:flex-1 webbutler:flex-col webbutler:items-center webbutler:justify-center webbutler:gap-1.5 webbutler:px-4 webbutler:text-center">
      <Icon
        size={16}
        aria-hidden
        className="webbutler:text-[var(--wc-text-4)]"
      />
      <p className="webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
        {children}
      </p>
    </div>
  );
}

/** A header-bar text action ("Clear all", "Clear old"): quiet until
    hovered, sized to sit beside the search field. */
export function HeaderAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
    >
      {children}
    </button>
  );
}

/** An in-list aside — "Nothing matches", "Nothing applies to this page" —
    for lists that exist but have nothing to show right now. */
export function ListNote({ children }: { children: ReactNode }) {
  return (
    <p className="webbutler:px-3 webbutler:py-4 webbutler:text-center webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
      {children}
    </p>
  );
}

/** The small bordered button of the Providers/Settings rows ("Connect",
    "Add", "Reset"). tabIndex −1: those pages rove focus by ROW, and the
    row's key handling activates the control. */
export function MiniButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      onClick={onClick}
      className="webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:bg-[var(--wc-hover-1)]"
    >
      {children}
    </button>
  );
}

/**
 * The search behavior behind HeaderSearch, shared by every searchable
 * list: query state plus the case-insensitive filter over whatever text
 * the caller deems searchable per item.
 */
export function useListSearch<T>(items: T[], haystack: (item: T) => string) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? items.filter((item) => haystack(item).toLowerCase().includes(needle))
    : items;
  return { query, setQuery, needle, shown };
}

/**
 * The header's inline search: a quiet underline-less field that filters
 * the page's list as you type. Narrow at rest, wider while it has focus
 * or content; the clear button appears with content. Lives in the header
 * (not the list) so it never scrolls away.
 */
export function HeaderSearch({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <span
      className={`webbutler:flex webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-transparent webbutler:py-0.5 webbutler:pr-1 webbutler:pl-1.5 webbutler:transition-all webbutler:duration-150 webbutler:focus-within:border-[var(--wc-border-hairline)] webbutler:focus-within:bg-[var(--wc-hover-1)] ${
        value ? "webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)]" : ""
      }`}
    >
      <HiMagnifyingGlass
        size={10}
        aria-hidden
        className="webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
      />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // The shell's global hotkeys (Esc collapses) must not fire while
          // the user is just clearing the search.
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`webbutler:border-none webbutler:bg-transparent webbutler:text-[11px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:transition-[width] webbutler:duration-150 webbutler:placeholder:text-[var(--wc-text-4)] ${
          value ? "webbutler:w-28" : "webbutler:w-14 webbutler:focus:w-28"
        }`}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="webbutler:flex webbutler:size-3.5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:hover:text-[var(--wc-ink)]"
        >
          <HiXMark size={10} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
