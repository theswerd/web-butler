import type { ReactNode } from "react";

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
