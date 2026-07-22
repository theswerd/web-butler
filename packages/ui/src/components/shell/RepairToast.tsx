import { useEffect, useRef, useState } from 'react';
import { HiExclamationTriangle, HiXMark } from 'react-icons/hi2';
import type { SiteExtension } from '../../lib/shell';

/** Long fuse: this is a question, not a notification — but it must not
    squat on the dock forever if the user is ignoring it. */
const AUTO_DISMISS_MS = 30_000;

type RepairToastProps = {
  extension: SiteExtension;
  /** The script's own diagnosis, e.g. "no element matches nav.sidebar". */
  reason: string;
  /** "Fix it" — the shell sends the agent a repair prompt. */
  onFix: () => void;
  onDismiss: () => void;
};

/**
 * The proactive repair ask. An extension's self-check just failed on this
 * page (the site changed under it), so the shell asks: can the butler try
 * to fix it? Shown once per broken version, only on the tab that saw the
 * breakage.
 */
export function RepairToast({
  extension,
  reason,
  onFix,
  onDismiss,
}: RepairToastProps) {
  const [hovered, setHovered] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (hovered) return;
    const id = window.setTimeout(
      () => onDismissRef.current?.(),
      AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(id);
  }, [hovered, extension.id]);

  return (
    <div
      role="alertdialog"
      aria-label={`Extension "${extension.name}" looks broken`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:rounded-[16px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:px-3 webbutler:py-2 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150"
    >
      <HiExclamationTriangle
        size={13}
        aria-hidden
        className="webbutler:mt-[3px] webbutler:shrink-0 webbutler:text-[#F59E0B]"
      />
      <div className="webbutler:min-w-0 webbutler:flex-1">
        <p className="webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
          "{extension.name}" seems broken on this page
        </p>
        <p className="webbutler:truncate webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
          {/* The script's own diagnosis — also the repair's starting clue. */}
          {reason} · Want me to try to fix it?
        </p>
        <div className="webbutler:mt-1.5 webbutler:flex webbutler:items-center webbutler:gap-1.5">
          <button
            type="button"
            onClick={onFix}
            className="webbutler:cursor-pointer webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-2.5 webbutler:py-1 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
          >
            Fix it
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-2.5 webbutler:py-1 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-text-2)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)]"
          >
            Not now
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
      >
        <HiXMark size={12} aria-hidden />
      </button>
    </div>
  );
}
