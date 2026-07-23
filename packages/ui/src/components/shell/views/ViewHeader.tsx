import type { ReactNode } from "react";
import { HiMagnifyingGlass, HiXMark } from "react-icons/hi2";

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
