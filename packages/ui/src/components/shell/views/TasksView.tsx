import {
  HiArrowPath,
  HiDocumentText,
  HiOutlineClock,
  HiOutlinePuzzlePiece,
  HiOutlineTrash,
} from "react-icons/hi2";
import type { Task } from "../../../lib/shell";
import { ViewHeader } from "./ViewHeader";

/** "just now", "4m", "2h", "3d" — compact, list-friendly. */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type TasksViewProps = {
  tasks: Task[];
  /** A row's report chip was clicked — the shell opens it in the panel. */
  onOpenReport?: (task: Task) => void;
  /** A row's extension chip was clicked — jump to the Extensions view. */
  onOpenExtensions?: () => void;
  /** The row itself was clicked — its transcript opens in the Chrome side
      panel: live while running, a replay once settled. */
  onOpenTask?: (task: Task) => void;
  /** Retry on a failed/stopped row — the shell re-sends that prompt. */
  onRetry?: (task: Task) => void;
  /** Trash one row. Trashing a running row doesn't cancel the work; it
      just drops the bookkeeping. */
  onRemove?: (task: Task) => void;
  /** Bulk trash: 'old' clears settled history, 'all' empties the list. */
  onClear?: (mode: "old" | "all") => void;
};

/** The status marker: pulsing while running, tinted once settled. */
function StatusDot({ task }: { task: Task }) {
  if (task.status === "running") {
    return (
      <span
        aria-hidden
        className="webbutler:mt-[5px] webbutler:size-1.5 webbutler:shrink-0 webbutler:animate-pulse webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
      />
    );
  }
  const tone =
    task.status === "failed"
      ? "webbutler:bg-[#e5484d]"
      : task.status === "stopped"
        ? "webbutler:bg-[var(--wc-text-4)]"
        : !task.seen
          ? "webbutler:bg-[var(--wc-selection)]"
          : "webbutler:bg-transparent";
  return (
    <span
      aria-hidden
      className={`webbutler:mt-[5px] webbutler:size-1.5 webbutler:shrink-0 webbutler:rounded-full ${tone}`}
    />
  );
}

/** "This tab" for page questions, "Background" for delegated jobs. */
function scopeLabel(task: Task): string {
  return task.scope === "global" ? "Background" : "This tab";
}

/**
 * The session's activity, ongoing first, then history newest-first. This
 * list is identical in every tab — it's global state owned by the
 * background script. Unseen finished rows carry an accent dot; opening
 * this view marks everything seen (the shell sends that, so badges drop
 * in all tabs at once).
 */
export function TasksView({
  tasks,
  onOpenReport,
  onOpenExtensions,
  onOpenTask,
  onRetry,
  onRemove,
  onClear,
}: TasksViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
        <ViewHeader label="Tasks" />
        <div className="webbutler:flex webbutler:flex-1 webbutler:flex-col webbutler:items-center webbutler:justify-center webbutler:gap-1.5 webbutler:px-4 webbutler:text-center">
          <HiOutlineClock
            size={16}
            aria-hidden
            className="webbutler:text-[var(--wc-text-4)]"
          />
          <p className="webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            Nothing yet. Everything you ask for shows up here: in progress and
            done.
          </p>
        </div>
      </div>
    );
  }

  const running = tasks.filter((task) => task.status === "running");
  const settled = tasks.filter((task) => task.status !== "running");

  const row = (task: Task) => {
    // The row's main click always opens the task itself — its transcript
    // in the side panel (live while running, a replay once settled). What
    // the task PRODUCED is a separate thing with its own button on the
    // right: a report chip opens the report, an extension chip jumps to
    // the Extensions view. One row, two destinations, no guessing.
    const open = onOpenTask && (() => onOpenTask(task));
    const openable = Boolean(open);
    // The main area and the trailing controls are separate buttons, so
    // the row itself is a plain container (buttons can't nest).
    const Main = openable ? "button" : "div";
    const primary =
      task.status === "running" ? task.prompt : (task.outcome ?? task.prompt);
    const highlight = task.status === "running" || !task.seen;
    const retryable =
      onRetry && (task.status === "failed" || task.status === "stopped");
    // The output chip: what this task left behind, opened directly.
    const output =
      task.status === "done" && task.reportId && onOpenReport
        ? {
            Icon: HiDocumentText,
            label: "Open report",
            onOpen: () => onOpenReport(task),
          }
        : task.status === "done" && task.extensionId && onOpenExtensions
          ? {
              Icon: HiOutlinePuzzlePiece,
              label: "View extension",
              onOpen: onOpenExtensions,
            }
          : null;
    return (
      <div
        key={task.id}
        className={`webbutler:group webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-1.5 ${
          openable
            ? "webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
            : ""
        }`}
      >
        <Main
          {...(openable ? { type: "button" as const, onClick: open } : {})}
          title={openable ? "View task" : undefined}
          className={`webbutler:flex webbutler:min-w-0 webbutler:flex-1 webbutler:items-start webbutler:gap-2 webbutler:text-left ${
            openable ? "webbutler:cursor-pointer" : ""
          }`}
        >
          <span className="webbutler:flex webbutler:w-1.5 webbutler:shrink-0 webbutler:justify-center">
            <StatusDot task={task} />
          </span>
          <div className="webbutler:min-w-0 webbutler:flex-1">
            <p
              className={`webbutler:truncate webbutler:text-[12px] ${
                highlight
                  ? "webbutler:font-medium webbutler:text-[var(--wc-ink)]"
                  : "webbutler:text-[var(--wc-text-2)]"
              }`}
            >
              {primary}
            </p>
            <p className="webbutler:truncate webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
              {scopeLabel(task)}
              {task.status === "failed" ? " · failed" : ""}
              {task.status === "stopped" ? " · stopped" : ""}
              {/* Finished rows led with the outcome; keep the ask findable. */}
              {task.status !== "running" && task.outcome
                ? ` · ${task.prompt}`
                : ""}
            </p>
          </div>
        </Main>
        {output ? (
          // Always visible — the deliverable is the row's point, not a
          // hover secret. Accent while the task is still unseen.
          <button
            type="button"
            title={output.label}
            aria-label={`${output.label}: ${task.prompt}`}
            onClick={output.onOpen}
            className={`webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] ${
              task.seen
                ? "webbutler:text-[var(--wc-text-3)]"
                : "webbutler:text-[var(--wc-selection)]"
            }`}
          >
            <output.Icon size={12} aria-hidden />
          </button>
        ) : null}
        {retryable ? (
          <button
            type="button"
            title="Retry"
            aria-label={`Retry: ${task.prompt}`}
            onClick={() => onRetry(task)}
            className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded webbutler:text-[var(--wc-text-4)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
          >
            <HiArrowPath size={11} aria-hidden />
          </button>
        ) : null}
        {onRemove ? (
          // Hover-revealed, but the slot is always reserved so timestamps
          // stay on one axis whether or not the pointer is on the row.
          <button
            type="button"
            title={
              task.status === "running" ? "Remove (keeps running)" : "Remove"
            }
            aria-label={`Remove: ${task.prompt}`}
            onClick={() => onRemove(task)}
            className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded webbutler:text-[var(--wc-text-4)] webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
          >
            <HiOutlineTrash size={11} aria-hidden />
          </button>
        ) : null}
        <span className="webbutler:shrink-0 webbutler:pt-px webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
          {task.status === "running"
            ? "now"
            : timeAgo(task.finishedAt ?? task.startedAt)}
        </span>
      </div>
    );
  };

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
      {/* "Clear old" spares in-flight rows, so it only earns its place
          once there's history to clear. */}
      <ViewHeader
        label={running.length > 0 ? `${running.length} running` : "Tasks"}
      >
        {onClear && settled.length > 0 ? (
          <button
            type="button"
            onClick={() => onClear("old")}
            className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
          >
            Clear old
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            onClick={() => onClear("all")}
            className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
          >
            Clear all
          </button>
        ) : null}
      </ViewHeader>
      <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:pb-1.5 webbutler:pt-0.5">
        {running.map(row)}
        {settled.map(row)}
      </div>
    </div>
  );
}
