import { useEffect, useRef, useState } from 'react';
import { HiCheck, HiExclamationTriangle, HiXMark } from 'react-icons/hi2';
import type { Task } from '../../lib/shell';

const AUTO_DISMISS_MS = 6_000;

type TaskToastProps = {
  task: Task;
  /** Toast clicked — report tasks open the side panel, others the menu. */
  onOpen?: () => void;
  onDismiss?: () => void;
};

/**
 * The transient cross-tab surface for a task that just finished off-tab.
 * Broadcast means every tab shows this at its dock the moment a global run
 * completes — the sibling of the tab-scoped AnswerCard, which only the
 * origin tab renders.
 *
 * Deliberately minimal: one line — accent dot, outcome, dismiss. The whole
 * pill is the open target (hover highlights it); only the X opts out.
 * Auto-dismisses after a few seconds (paused while hovered); the task
 * itself stays in the Tasks view until seen.
 */
export function TaskToast({ task, onOpen, onDismiss }: TaskToastProps) {
  const [hovered, setHovered] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const title = task.outcome ?? task.prompt;

  useEffect(() => {
    if (hovered) return;
    const id = window.setTimeout(
      () => onDismissRef.current?.(),
      AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(id);
  }, [hovered, task.id]);

  return (
    // Not a <button>: the dismiss control lives inside, and nested buttons
    // are invalid HTML. role/tabIndex keep it keyboard-operable.
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open: ${title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen?.();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="webbutler:flex webbutler:w-full webbutler:cursor-pointer webbutler:select-none webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:py-1.5 webbutler:pr-1.5 webbutler:pl-3 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:bg-[var(--wc-hover-1)]"
    >
      {/* Same verdict icons as the in-tab status pill (AnswerCard), so a
          finish reads the same whether it lands here or there. */}
      {task.status === 'failed' ? (
        <HiExclamationTriangle
          size={13}
          aria-hidden
          className="webbutler:shrink-0 webbutler:text-[#e5484d]"
        />
      ) : (
        <HiCheck
          size={13}
          aria-hidden
          className="webbutler:shrink-0 webbutler:text-[var(--wc-selection)]"
        />
      )}
      <span className="webbutler:min-w-0 webbutler:flex-1 webbutler:truncate webbutler:text-[12px] webbutler:text-[var(--wc-ink)]">
        {title}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss?.();
        }}
        className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
      >
        <HiXMark size={12} aria-hidden />
      </button>
    </div>
  );
}
