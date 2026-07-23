import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import {
  HiMiniStop,
  HiMinus,
  HiOutlineDocumentText,
  HiXMark,
} from 'react-icons/hi2';
import type { Task } from '../../lib/shell';
import { SPRING_UI } from '../../lib/motion';

type TaskStripProps = {
  /** What to show, newest first — the caller picks (running + fresh
      finishes) and caps the list. */
  tasks: Task[];
  /** The task the next message will be added onto, if any. */
  selectedId: string | null;
  /** Chip body clicked — reference this task (the caller toggles). */
  onSelect: (task: Task) => void;
  /** Open the task's live activity / transcript in the side panel. */
  onOpen: (task: Task) => void;
  /** Stop a running task. */
  onCancel: (task: Task) => void;
  /** Dismiss a settled chip from the strip (marks it seen). */
  onDismiss: (task: Task) => void;
};

const STATUS_LABEL: Record<Task['status'], string> = {
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** The one status that gets color; everything else stays in ink tones. */
function statusDot(status: Task['status']) {
  if (status === 'failed') return 'webbutler:bg-[#e5484d]';
  if (status === 'done') return 'webbutler:bg-[var(--wc-selection)]';
  if (status === 'stopped') return 'webbutler:bg-[var(--wc-text-3)]';
  return 'webbutler:bg-[var(--wc-selection)]';
}

/** A soft ping behind the dot while the butler works. */
function StatusMark({ task }: { task: Task }) {
  return (
    <span className="webbutler:relative webbutler:flex webbutler:size-1.5 webbutler:shrink-0">
      {task.status === 'running' ? (
        <motion.span
          aria-hidden
          className={`webbutler:absolute webbutler:inset-0 webbutler:rounded-full ${statusDot(task.status)}`}
          animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      <span
        aria-hidden
        className={`webbutler:relative webbutler:size-1.5 webbutler:rounded-full ${statusDot(task.status)}`}
      />
    </span>
  );
}

/**
 * The live task indicator that docks with the prompt, in every tab. Each
 * task is a fixed-size pill (264px: two per row in the 560px shell, with
 * the minimize control alongside) showing the task's status, its prompt,
 * and (while running) the newest line of its activity feed. The size
 * never follows the content — text truncates inside it — so pills don't
 * shift as activity streams in or on hover.
 *
 * A pill's body is a click target that REFERENCES the task, the same
 * gesture as referencing a page element: the next message sent goes onto
 * that task's conversation instead of starting a new one. Trailing
 * controls open the transcript and stop/dismiss.
 *
 * The whole strip minimizes to a single count pill (pulsing while
 * anything runs) via the trailing "–" control, for when you want the
 * tasks out of the way but not out of mind.
 */
export function TaskStrip({
  tasks,
  selectedId,
  onSelect,
  onOpen,
  onCancel,
  onDismiss,
}: TaskStripProps) {
  const [minimized, setMinimized] = useState(false);

  if (tasks.length === 0) return null;

  const running = tasks.filter((task) => task.status === 'running').length;
  const anyUnseen = tasks.some(
    (task) => task.status !== 'running' && !task.seen,
  );

  if (minimized) {
    const summary =
      running > 0
        ? `${running} running${tasks.length > running ? ` · ${tasks.length - running} done` : ''}`
        : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    return (
      <div className="webbutler:flex webbutler:w-full">
        <motion.button
          type="button"
          layout
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={SPRING_UI}
          aria-label={`Show tasks: ${summary}`}
          aria-expanded={false}
          onClick={() => setMinimized(false)}
          className="webbutler:flex webbutler:cursor-pointer webbutler:select-none webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:py-0.5 webbutler:pr-2 webbutler:pl-2 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-[border-color,box-shadow] webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]"
        >
          <span className="webbutler:relative webbutler:flex webbutler:size-1.5 webbutler:shrink-0">
            {running > 0 ? (
              <motion.span
                aria-hidden
                className="webbutler:absolute webbutler:inset-0 webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
                animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
              />
            ) : null}
            <span
              aria-hidden
              className={`webbutler:relative webbutler:size-1.5 webbutler:rounded-full ${
                running > 0 || anyUnseen
                  ? 'webbutler:bg-[var(--wc-selection)]'
                  : 'webbutler:bg-[var(--wc-text-3)]'
              }`}
            />
          </span>
          <span className="webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-text-2)]">
            {summary}
          </span>
        </motion.button>
      </div>
    );
  }

  return (
    <div className="webbutler:flex webbutler:w-full webbutler:flex-wrap webbutler:items-center webbutler:gap-1">
      <AnimatePresence initial={false}>
        {tasks.map((task) => {
          const selected = task.id === selectedId;
          const isRunning = task.status === 'running';
          // The pill's second line of life, width-capped so a pill never
          // sprawls: live activity while running, the outcome once done,
          // an accent "replying" note while referenced.
          const detail = selected
            ? 'replying'
            : isRunning
              ? (task.activity ?? 'Starting…')
              : (task.outcome ?? STATUS_LABEL[task.status]);
          return (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={SPRING_UI}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={
                selected
                  ? `Stop replying to: ${task.prompt}`
                  : `Reply to this task: ${task.prompt}`
              }
              onClick={() => onSelect(task)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect(task);
              }}
              className={`webbutler:group webbutler:flex webbutler:w-[264px] webbutler:max-w-full webbutler:cursor-pointer webbutler:select-none webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:border webbutler:py-0.5 webbutler:pr-0.5 webbutler:pl-2 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-[background-color,border-color,box-shadow] webbutler:duration-100 ${
                selected
                  ? 'webbutler:border-[var(--wc-selection)] webbutler:bg-[var(--wc-surface)] webbutler:shadow-[0_0_0_0.5px_var(--wc-selection)]'
                  : // Hover tints ON TOP of the surface (inset shadow) instead
                    // of replacing it — hover-1 alone is a near-transparent
                    // overlay color, and swapping it in lets the page bleed
                    // through the pill.
                    'webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]'
              }`}
            >
              <StatusMark task={task} />

              <span
                title={task.prompt}
                className="webbutler:max-w-[120px] webbutler:shrink-0 webbutler:truncate webbutler:text-[11px] webbutler:leading-4 webbutler:font-medium webbutler:text-[var(--wc-ink)]"
              >
                {task.prompt}
              </span>

              {/* Swaps drift up a few px so changes read as motion, not
                  flicker. title carries the full text the cap hides. */}
              <span
                title={detail}
                className={`webbutler:min-w-0 webbutler:flex-1 webbutler:truncate webbutler:text-[10px] ${
                  selected
                    ? 'webbutler:text-[var(--wc-selection)]'
                    : isRunning
                      ? 'webbutler:text-[var(--wc-text-4)]'
                      : 'webbutler:text-[var(--wc-text-3)]'
                }`}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={detail}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="webbutler:inline-block webbutler:max-w-full webbutler:truncate webbutler:align-bottom"
                  >
                    {detail}
                  </motion.span>
                </AnimatePresence>
              </span>

              {/* Transcript: always reachable, quiet until hovered. */}
              <button
                type="button"
                aria-label="Open task activity"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(task);
                }}
                className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
              >
                <HiOutlineDocumentText size={11} aria-hidden />
              </button>

              {isRunning ? (
                <button
                  type="button"
                  aria-label="Stop this task"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancel(task);
                  }}
                  className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[#e5484d]"
                >
                  <HiMiniStop size={10} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDismiss(task);
                  }}
                  className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
                >
                  <HiXMark size={11} aria-hidden />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Tuck the strip away — it becomes the count pill above. */}
      <motion.button
        type="button"
        layout
        aria-label="Minimize tasks"
        aria-expanded
        onClick={() => setMinimized(true)}
        className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
      >
        <HiMinus size={11} aria-hidden />
      </motion.button>
    </div>
  );
}
