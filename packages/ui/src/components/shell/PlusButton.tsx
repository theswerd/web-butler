import { motion } from 'motion/react';
import { forwardRef } from 'react';
import { BowtieMark } from './BowtieMark';

type PlusButtonProps = {
  unread: number;
  open: boolean;
  onClick: () => void;
  /** A task is running — the bowtie loops its pulled-apart animation. */
  working?: boolean;
  /** ArrowRight from the button — hands focus back to the prompt input. */
  onArrowRight?: () => void;
};

export const PlusButton = forwardRef<HTMLButtonElement, PlusButtonProps>(
  function PlusButton({ unread, open, onClick, working = false, onArrowRight }, ref) {
    return (
      <div className="webbutler:relative webbutler:shrink-0">
        <motion.button
          ref={ref}
          type="button"
          title={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-label={unread > 0 ? `Menu, ${unread} finished tasks` : 'Menu'}
          initial="rest"
          animate="rest"
          whileHover="adjust"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              event.stopPropagation();
              onArrowRight?.();
            }
          }}
          className="webbutler:inline-flex webbutler:size-[26px] webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border-soft)] webbutler:bg-[var(--wc-hover-2)] webbutler:p-0 webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:hover:bg-[var(--wc-hover-3)] webbutler:focus-visible:ring-2 webbutler:focus-visible:ring-[var(--wc-ring-strong)] webbutler:focus-visible:ring-offset-1 webbutler:focus-visible:ring-offset-[var(--wc-surface-solid)]"
        >
          <span
            className="webbutler:inline-flex webbutler:items-center webbutler:justify-center webbutler:transition-transform webbutler:duration-150 webbutler:ease-out"
            style={{
              transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
            }}
          >
            <BowtieMark
              size={15}
              working={working}
              // Accent knot while the menu is open or the butler is busy —
              // the "active" signal matches the collapsed pill's.
              knot={
                open || working
                  ? 'var(--wc-selection)'
                  : 'var(--wc-knot, #a3a3a3)'
              }
            />
          </span>
        </motion.button>
        {unread > 0 ? (
          <span className="webbutler:absolute webbutler:-top-1 webbutler:-right-1 webbutler:flex webbutler:h-4 webbutler:min-w-4 webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:border-[1.5px] webbutler:border-[var(--wc-surface-solid)] webbutler:bg-[var(--wc-accent)] webbutler:px-1 webbutler:text-[9px] webbutler:font-bold webbutler:leading-none webbutler:text-[var(--wc-accent-fg)]">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </div>
    );
  },
);
