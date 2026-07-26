import { motion } from 'motion/react';
import type { IconType } from 'react-icons';
import {
  HiArrowUpRight,
  HiOutlineDocumentText,
  HiOutlineSignal,
} from 'react-icons/hi2';
import { BowtieMark } from '../shell/BowtieMark';

/**
 * The side panel before anything has landed in it. Not just a "nothing
 * here" line: it explains the two surfaces this panel hosts (reports and
 * live task feeds) as ghosted previews of the cards they'll arrive as,
 * and offers example prompts that prefill the shell in the active tab —
 * the fastest route from "empty" to "something here".
 */

const EXAMPLES = [
  'Turn this page into a report',
  'Extract every table on this page',
  'Compare the options listed here',
];

/** Stagger the column in: mark, copy, previews, prompts. */
const rise = (order: number) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, delay: 0.05 * order, ease: 'easeOut' as const },
});

export function PanelEmptyState({
  onTryPrompt,
}: {
  /** Send an example prompt to the shell's input in the active tab.
      Omitted (Storybook, detached hosts): the examples don't render. */
  onTryPrompt?: (text: string) => void;
}) {
  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col webbutler:items-center webbutler:justify-center webbutler:overflow-y-auto webbutler:bg-[var(--wc-surface-solid)] webbutler:px-6 webbutler:py-8">
      <div className="webbutler:flex webbutler:w-full webbutler:max-w-[300px] webbutler:flex-col">
        <motion.div
          {...rise(0)}
          className="webbutler:flex webbutler:flex-col webbutler:items-center webbutler:text-center"
        >
          <span className="webbutler:text-[var(--wc-text-3)]">
            <BowtieMark size={26} />
          </span>
          <h2 className="webbutler:pt-2.5 webbutler:text-[13px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
            Nothing open yet
          </h2>
          <p className="webbutler:pt-1 webbutler:text-[11px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-3)]">
            Long-form work lands here, next to the page it's about.
          </p>
        </motion.div>

        <motion.div
          {...rise(1)}
          className="webbutler:flex webbutler:flex-col webbutler:gap-1.5 webbutler:pt-5"
        >
          <PreviewCard
            icon={HiOutlineDocumentText}
            kicker="Report"
            title="The butler's write-ups"
            detail="Tables, research, drafts: anything too big for the answer card."
          />
          <PreviewCard
            icon={HiOutlineSignal}
            kicker="Live task"
            title="Watch it work"
            detail="Open a running task from the Tasks list to follow along."
          />
        </motion.div>

        {onTryPrompt ? (
          <motion.div {...rise(2)} className="webbutler:pt-5">
            <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
              Try asking
            </p>
            <div className="webbutler:flex webbutler:flex-col webbutler:items-start webbutler:gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onTryPrompt(example)}
                  className="webbutler:flex webbutler:max-w-full webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2.5 webbutler:py-1 webbutler:text-left webbutler:text-[11px] webbutler:leading-4 webbutler:text-[var(--wc-text-2)] webbutler:transition-[border-color,box-shadow,color] webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:text-[var(--wc-ink)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]"
                >
                  <HiArrowUpRight
                    size={10}
                    aria-hidden
                    className="webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
                  />
                  <span className="webbutler:min-w-0 webbutler:truncate">
                    {example}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

/** A ghosted version of the OutputCard the real thing will arrive as —
    same anatomy (icon tile, kicker, title, detail), rendered inert and
    quiet so it reads as "coming attractions", not a dead button. */
function PreviewCard({
  icon: Icon,
  kicker,
  title,
  detail,
}: {
  icon: IconType;
  kicker: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2.5 webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)] webbutler:px-3 webbutler:py-2.5">
      <span
        aria-hidden
        className="webbutler:flex webbutler:size-7 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-surface-solid)] webbutler:text-[var(--wc-text-3)]"
      >
        <Icon size={14} />
      </span>
      <span className="webbutler:min-w-0 webbutler:flex-1">
        <span className="webbutler:block webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
          {kicker}
        </span>
        <span className="webbutler:block webbutler:text-[12px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
          {title}
        </span>
        <span className="webbutler:block webbutler:pt-px webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-3)]">
          {detail}
        </span>
      </span>
    </div>
  );
}
