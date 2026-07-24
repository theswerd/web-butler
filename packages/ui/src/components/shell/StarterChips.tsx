import { motion } from 'motion/react';
import { SPRING_UI } from '../../lib/motion';

/**
 * One-tap starter prompts over the empty prompt box — the page-aware
 * "here's what I can do" chips. Tapping one prefills the prompt (never
 * auto-sends): the user can edit before committing, and typing anything
 * hides the row. Visually these float on the page like the task pills, so
 * they carry the surface treatment themselves.
 *
 * Hints, not content: the row is hard-capped to ONE line. Chips never
 * wrap — they shrink and truncate to share the width instead.
 */
export function StarterChips({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="webbutler:flex webbutler:w-full webbutler:min-w-0 webbutler:flex-nowrap webbutler:justify-end webbutler:gap-1">
      {prompts.map((prompt, index) => (
        <motion.button
          key={prompt}
          type="button"
          title={prompt}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING_UI, delay: 0.04 * index }}
          onClick={() => onPick(prompt)}
          className="webbutler:min-w-0 webbutler:shrink webbutler:cursor-pointer webbutler:truncate webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:text-[var(--wc-ink)]"
        >
          {prompt}
        </motion.button>
      ))}
    </div>
  );
}
