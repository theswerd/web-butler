import { AnimatePresence, motion } from 'motion/react';
import { HiViewfinderCircle, HiXMark } from 'react-icons/hi2';
import { SPRING_UI } from '../../lib/motion';
import type { PickedElement } from '../../lib/page-elements';

type ContextChipsProps = {
  elements: PickedElement[];
  /** References that no longer resolve — rendered grayed out. */
  missingIds: ReadonlySet<string>;
  onRemove: (id: string) => void;
  /** Chip under the pointer — the shell glows the matching page element. */
  onHover: (element: PickedElement | null) => void;
  /** Chip clicked — the shell scrolls the page to the element. */
  onJump: (element: PickedElement) => void;
};

/** Picked-element references shown above the prompt, removable. */
export function ContextChips({
  elements,
  missingIds,
  onRemove,
  onHover,
  onJump,
}: ContextChipsProps) {
  return (
    <div className="webbutler:flex webbutler:flex-wrap webbutler:justify-end webbutler:gap-1">
      <AnimatePresence initial={false}>
        {elements.map((element) => {
          const missing = missingIds.has(element.id);
          return (
          <motion.span
            key={element.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={SPRING_UI}
            title={
              missing
                ? `Removed from page${element.text ? ` (was "${element.text}")` : ''}`
                : element.text
                  ? `"${element.text}"`
                  : element.selector
            }
            onMouseEnter={() => onHover(element)}
            onMouseLeave={() => onHover(null)}
            onClick={() => {
              if (!missing) onJump(element);
            }}
            className={`webbutler:inline-flex webbutler:select-none webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:py-0.5 webbutler:pr-0.5 webbutler:pl-2 webbutler:backdrop-blur-2xl webbutler:transition-colors webbutler:duration-100 ${
              missing
                ? 'webbutler:border-dashed webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface-soft)]'
                : 'webbutler:cursor-pointer webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:bg-[var(--wc-surface-solid)]'
            }`}
          >
            <HiViewfinderCircle
              size={10}
              className="webbutler:shrink-0 webbutler:text-[var(--wc-selection)]"
              aria-hidden
            />
            {/* Missing: struck through but still a readable gray. */}
            <span
              className={`webbutler:max-w-[160px] webbutler:truncate webbutler:font-mono webbutler:text-[10px] ${
                missing
                  ? 'webbutler:text-[var(--wc-text-3)] webbutler:line-through'
                  : 'webbutler:text-[var(--wc-text-2)]'
              }`}
            >
              {element.label}
            </span>
            <button
              type="button"
              aria-label={`Remove ${element.label}`}
              onClick={(event) => {
                // Removing shouldn't also jump to the element.
                event.stopPropagation();
                onRemove(element.id);
              }}
              className="webbutler:flex webbutler:size-3.5 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:hover:bg-[var(--wc-hover-3)] webbutler:hover:text-[var(--wc-ink)]"
            >
              <HiXMark size={9} aria-hidden />
            </button>
          </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
