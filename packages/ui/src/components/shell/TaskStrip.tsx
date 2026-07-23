import { AnimatePresence, motion } from 'motion/react';
import { HiMiniStop, HiOutlineDocumentText, HiXMark } from 'react-icons/hi2';
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

/**
 * The live task indicator that docks with the prompt: one compact row per
 * ongoing (or just-finished) task, in every tab. Each row shows the task's
 * status, its prompt, and — while running — the newest line of its
 * activity feed, so "what is it doing right now" is visible without
 * opening anything.
 *
 * The row body is a click target that REFERENCES the task, the same
 * gesture as referencing a page element: the next message sent goes onto
 * that task's conversation instead of starting a new one. The trailing
 * controls open the transcript and stop/dismiss.
 */
export function TaskStrip({
  tasks,
  selectedId,
  onSelect,
  onOpen,
  onCancel,
  onDismiss,
}: TaskStripProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="webbutler:flex webbutler:w-full webbutler:flex-col webbutler:gap-1">
      <AnimatePresence initial={false}>
        {tasks.map((task) => {
          const selected = task.id === selectedId;
          const running = task.status === 'running';
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
              className={`webbutler:group webbutler:flex webbutler:w-full webbutler:cursor-pointer webbutler:select-none webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:border webbutler:py-1 webbutler:pr-1 webbutler:pl-2.5 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:transition-[background-color,border-color,box-shadow] webbutler:duration-100 ${
                selected
                  ? 'webbutler:border-[var(--wc-selection)] webbutler:bg-[var(--wc-surface)] webbutler:shadow-[0_0_0_0.5px_var(--wc-selection)]'
                  : 'webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:bg-[var(--wc-hover-1)]'
              }`}
            >
              {/* Status: a steady dot, pulsing while the butler works. */}
              <span className="webbutler:relative webbutler:flex webbutler:size-1.5 webbutler:shrink-0">
                {running ? (
                  <motion.span
                    aria-hidden
                    className={`webbutler:absolute webbutler:inset-0 webbutler:rounded-full ${statusDot(task.status)}`}
                    animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
                    transition={{
                      duration: 1.6,
                      repeat: Infinity,
                      ease: 'easeOut',
                    }}
                  />
                ) : null}
                <span
                  aria-hidden
                  className={`webbutler:relative webbutler:size-1.5 webbutler:rounded-full ${statusDot(task.status)}`}
                />
              </span>

              <span className="webbutler:max-w-[38%] webbutler:shrink-0 webbutler:truncate webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
                {task.prompt}
              </span>

              {/* The living part: what it's doing right now (running), or
                  how it ended. Ambient while live (dimmest text), a shade
                  brighter once it's an outcome, accent while replying.
                  Swaps drift up a few px so changes read as motion, not
                  flicker. */}
              <span
                className={`webbutler:min-w-0 webbutler:flex-1 webbutler:truncate webbutler:text-[11px] ${
                  selected
                    ? 'webbutler:text-[var(--wc-selection)]'
                    : running
                      ? 'webbutler:text-[var(--wc-text-4)]'
                      : 'webbutler:text-[var(--wc-text-3)]'
                }`}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={
                      selected
                        ? 'replying'
                        : running
                          ? (task.activity ?? 'starting')
                          : task.status
                    }
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="webbutler:inline-block webbutler:max-w-full webbutler:truncate webbutler:align-bottom"
                  >
                    {selected
                      ? 'Your next message continues this task'
                      : running
                        ? (task.activity ?? 'Starting…')
                        : (task.outcome ?? STATUS_LABEL[task.status])}
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
                className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
              >
                <HiOutlineDocumentText size={12} aria-hidden />
              </button>

              {running ? (
                <button
                  type="button"
                  aria-label="Stop this task"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancel(task);
                  }}
                  className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[#e5484d]"
                >
                  <HiMiniStop size={11} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDismiss(task);
                  }}
                  className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
                >
                  <HiXMark size={12} aria-hidden />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
