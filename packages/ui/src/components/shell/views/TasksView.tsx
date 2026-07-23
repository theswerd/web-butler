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
  /** A row's extension chip was clicked — jump to the Extensions view
      with that extension highlighted. */
  onOpenExtensions?: (extensionId: string) => void;
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

/** The status marker: a soft ping while running, tinted once settled.
    Sized to sit centered against the row's first (12px) text line. */
function StatusDot({ task }: { task: Task }) {
  if (task.status === "running") {
    return (
      <span className="webbutler:relative webbutler:flex webbutler:size-1.5">
        <span
          aria-hidden
          className="webbutler:absolute webbutler:inline-flex webbutler:h-full webbutler:w-full webbutler:animate-ping webbutler:rounded-full webbutler:bg-[var(--wc-selection)] webbutler:opacity-50"
        />
        <span
          aria-hidden
          className="webbutler:relative webbutler:inline-flex webbutler:size-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
        />
      </span>
    );
  }
  const tone =
    task.status === "failed"
      ? "webbutler:bg-[#e5484d]"
      : task.status === "stopped"
        ? "webbutler:bg-[var(--wc-text-4)]"
        : !task.seen
          ? "webbutler:bg-[var(--wc-selection)]"
          : "webbutler:bg-[var(--wc-border-hairline)]";
  return (
    <span
      aria-hidden
      className={`webbutler:size-1.5 webbutler:rounded-full ${tone}`}
    />
  );
}

/** "This tab" for page questions, "Background" for delegated jobs. */
function scopeLabel(task: Task): string {
  return task.scope === "global" ? "Background" : "This tab";
}

/** "example.com" — where the prompt was sent from, for the meta line. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
    const isRunning = task.status === "running";
    const highlight = isRunning || !task.seen;
    const retryable =
      onRetry && (task.status === "failed" || task.status === "stopped");
    const host = hostLabel(task.url);
    // The one word of status the outcome line leads with — colored only
    // when it's bad news, so red stays meaningful.
    const statusWord =
      task.status === "failed" ? (
        <span className="webbutler:font-medium webbutler:text-[#e5484d]">
          Failed
        </span>
      ) : task.status === "stopped" ? (
        <span className="webbutler:text-[var(--wc-text-4)]">Stopped</span>
      ) : null;
    // The living middle line: what it's doing (running) or how it ended.
    const secondary = isRunning ? (task.activity ?? "Working…") : task.outcome;
    // The output chip: what this task left behind, opened directly.
    const output =
      task.status === "done" && task.reportId && onOpenReport
        ? {
            Icon: HiDocumentText,
            label: "Report",
            title: "Open report",
            onOpen: () => onOpenReport(task),
          }
        : task.status === "done" && task.extensionId && onOpenExtensions
          ? {
              Icon: HiOutlinePuzzlePiece,
              label: "Extension",
              title: "View extension",
              onOpen: () => onOpenExtensions(task.extensionId!),
            }
          : null;
    return (
      <div
        key={task.id}
        className={`webbutler:group webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-2 ${
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
          {/* Fixed-width status column, dot centered on the first line, so
              every row's text starts on the same axis. */}
          <span className="webbutler:flex webbutler:h-4 webbutler:w-2 webbutler:shrink-0 webbutler:items-center webbutler:justify-center">
            <StatusDot task={task} />
          </span>
          <div className="webbutler:min-w-0 webbutler:flex-1">
            {/* The ask, always first: rows scan by what you asked for. */}
            <p
              className={`webbutler:truncate webbutler:text-[12px] webbutler:leading-4 ${
                highlight
                  ? "webbutler:font-medium webbutler:text-[var(--wc-ink)]"
                  : "webbutler:text-[var(--wc-text-2)]"
              }`}
            >
              {task.prompt}
            </p>
            {/* The outcome (or live activity) as its own quiet line. */}
            {secondary || statusWord ? (
              <p className="webbutler:truncate webbutler:pt-px webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
                {statusWord}
                {statusWord && secondary ? " · " : ""}
                {secondary}
              </p>
            ) : null}
            <p className="webbutler:truncate webbutler:pt-px webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
              {scopeLabel(task)}
              {host ? ` · ${host}` : ""}
            </p>
          </div>
        </Main>
        {output ? (
          // Always visible — the deliverable is the row's point, not a
          // hover secret. A labeled pill so it reads as tappable; accent
          // while the task is still unseen.
          <button
            type="button"
            title={output.title}
            aria-label={`${output.title}: ${task.prompt}`}
            onClick={output.onOpen}
            className={`webbutler:flex webbutler:h-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:px-2 webbutler:text-[10px] webbutler:font-medium webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border)] webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)] ${
              task.seen
                ? "webbutler:text-[var(--wc-text-3)]"
                : "webbutler:text-[var(--wc-selection)]"
            }`}
          >
            <output.Icon size={11} aria-hidden />
            {output.label}
          </button>
        ) : null}
        {retryable ? (
          <button
            type="button"
            title="Retry"
            aria-label={`Retry: ${task.prompt}`}
            onClick={() => onRetry(task)}
            className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
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
            className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
          >
            <HiOutlineTrash size={11} aria-hidden />
          </button>
        ) : null}
        <span className="webbutler:shrink-0 webbutler:pt-[3px] webbutler:text-[10px] webbutler:tabular-nums webbutler:text-[var(--wc-text-4)]">
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
        {/* A quiet seam between what's moving and what's history. */}
        {running.length > 0 && settled.length > 0 ? (
          <div className="webbutler:flex webbutler:items-center webbutler:gap-2 webbutler:px-3 webbutler:pt-1.5 webbutler:pb-1">
            <span className="webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
              Earlier
            </span>
            <span
              aria-hidden
              className="webbutler:h-px webbutler:flex-1 webbutler:bg-[var(--wc-border-hairline)]"
            />
          </div>
        ) : null}
        {settled.map(row)}
      </div>
    </div>
  );
}
