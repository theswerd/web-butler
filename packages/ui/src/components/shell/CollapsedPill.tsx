import { motion } from 'motion/react';
import { BowtieMark } from './BowtieMark';

type CollapsedPillProps = {
  onOpen: () => void;
  unread?: number;
  /** A task is running — the bowtie loops its pulled-apart animation. */
  working?: boolean;
};

export function CollapsedPill({ onOpen, unread = 0, working = false }: CollapsedPillProps) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      aria-label={
        working
          ? 'Open Web Butler, working'
          : unread > 0
            ? `Open Web Butler, ${unread} finished tasks`
            : 'Open Web Butler'
      }
      initial="rest"
      animate="rest"
      whileHover="adjust"
      className="webbutler:relative webbutler:inline-flex webbutler:size-11 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:p-0 webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-[background-color,border-color] webbutler:duration-150 webbutler:hover:border-[var(--wc-border)] webbutler:hover:bg-[var(--wc-surface-hover)] webbutler:focus-visible:ring-2 webbutler:focus-visible:ring-[var(--wc-ring-strong)] webbutler:focus-visible:ring-offset-1"
    >
      {/* While busy, the knot takes the accent — same "active" signal the
          open shell's menu button shows. */}
      <BowtieMark
        size={24}
        working={working}
        knot={working ? 'var(--wc-selection)' : undefined}
      />
      {unread > 0 ? (
        <span className="webbutler:absolute webbutler:-top-1 webbutler:-right-1 webbutler:flex webbutler:h-4 webbutler:min-w-4 webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:border-[1.5px] webbutler:border-[var(--wc-surface-solid)] webbutler:bg-[var(--wc-accent)] webbutler:px-1 webbutler:text-[9px] webbutler:font-bold webbutler:leading-none webbutler:text-[var(--wc-accent-fg)]">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </motion.button>
  );
}
