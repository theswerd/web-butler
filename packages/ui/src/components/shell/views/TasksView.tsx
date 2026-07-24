import { motion } from "motion/react";
import {
  HiArrowPath,
  HiDocumentText,
  HiOutlineClock,
  HiOutlinePuzzlePiece,
  HiOutlineTrash,
} from "react-icons/hi2";
import type { Task } from "../../../lib/shell";
import { BowtieMark } from "../BowtieMark";
import { ListRow, RowIconButton, RowTime, timeAgo } from "./ListRow";
import {
  HeaderAction,
  HeaderSearch,
  ListNote,
  useListSearch,
  ViewBody,
  ViewEmpty,
  ViewFrame,
} from "./ViewHeader";

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

/** "example.com" — where the prompt was sent from. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * A running task: not a list row but a live card — accent-washed, led by
 * the working bowtie, with the agent's current activity breathing under
 * the prompt. The card opens the live transcript; trash only drops the
 * bookkeeping (the work keeps running).
 */
function LiveTaskCard({
  task,
  onOpen,
  onRemove,
}: {
  task: Task;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const Main = onOpen ? "button" : "div";
  const host = hostLabel(task.url);
  return (
    <div className="webbutler:group webbutler:relative webbutler:mx-1.5 webbutler:overflow-hidden webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border-hairline)]">
      {/* The wash: the theme accent at a whisper, so live rows read as a
          different temperature than history without shouting. */}
      <div
        aria-hidden
        className="webbutler:absolute webbutler:inset-0 webbutler:bg-[var(--wc-selection)] webbutler:opacity-[0.05]"
      />
      <div className="webbutler:relative webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:py-2 webbutler:pr-2 webbutler:pl-2.5">
        <Main
          {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
          title={onOpen ? "Watch live" : undefined}
          className={`webbutler:flex webbutler:min-w-0 webbutler:flex-1 webbutler:items-start webbutler:gap-2 webbutler:text-left ${
            onOpen ? "webbutler:cursor-pointer" : ""
          }`}
        >
          <span className="webbutler:flex webbutler:h-4 webbutler:shrink-0 webbutler:items-center">
            <BowtieMark size={13} working knot="var(--wc-selection)" />
          </span>
          <span className="webbutler:min-w-0 webbutler:flex-1">
            <span className="webbutler:block webbutler:truncate webbutler:text-[12px] webbutler:leading-4 webbutler:font-medium webbutler:text-[var(--wc-ink)]">
              {task.prompt}
            </span>
            {/* The living line: what it's doing right now, breathing. */}
            <motion.span
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="webbutler:block webbutler:truncate webbutler:pt-px webbutler:text-[11px] webbutler:text-[var(--wc-text-2)]"
            >
              {task.activity ?? "Working…"}
            </motion.span>
          </span>
        </Main>
        {onRemove ? (
          <RowIconButton
            title="Remove (keeps running)"
            ariaLabel={`Remove: ${task.prompt}`}
            onClick={onRemove}
            hoverReveal
          >
            <HiOutlineTrash size={11} aria-hidden />
          </RowIconButton>
        ) : null}
        <RowTime>
          {host ? `${host} · ` : ""}
          {timeAgo(task.startedAt)}
        </RowTime>
      </div>
    </div>
  );
}

/**
 * The session's activity, live work first, then history newest-first.
 * This list is identical in every tab — it's global state owned by the
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
  // Search filters by what you asked, what came back, and where.
  const { query, setQuery, shown } = useListSearch(tasks, (task) =>
    [task.prompt, task.outcome ?? "", task.url].join("\n"),
  );

  if (tasks.length === 0) {
    return (
      <ViewFrame label="Tasks">
        <ViewEmpty icon={HiOutlineClock}>
          Nothing yet. Everything you ask for shows up here: in progress and
          done.
        </ViewEmpty>
      </ViewFrame>
    );
  }

  const running = shown.filter((task) => task.status === "running");
  const settled = shown.filter((task) => task.status !== "running");

  const row = (task: Task) => {
    // The row's main click always opens the task itself — its transcript
    // in the side panel (a replay once settled). What the task PRODUCED
    // is a separate thing with its own button on the right: a report chip
    // opens the report, an extension chip jumps to the Extensions view.
    // One row, two destinations, no guessing.
    const highlight = !task.seen;
    const retryable =
      onRetry && (task.status === "failed" || task.status === "stopped");
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
    const host = hostLabel(task.url);
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
      <ListRow
        key={task.id}
        onOpen={onOpenTask && (() => onOpenTask(task))}
        openTitle="View task"
        leading={
          // Fixed-width column so every row's text starts on one axis:
          // an accent dot only while the outcome is unseen — seen history
          // doesn't need per-row furniture.
          <span className="webbutler:flex webbutler:h-4 webbutler:w-2 webbutler:shrink-0 webbutler:items-center webbutler:justify-center">
            <span
              aria-hidden
              className={`webbutler:size-1.5 webbutler:rounded-full ${
                task.status === "failed"
                  ? "webbutler:bg-[#e5484d]"
                  : highlight
                    ? "webbutler:bg-[var(--wc-selection)]"
                    : "webbutler:bg-[var(--wc-border-hairline)]"
              }`}
            />
          </span>
        }
        title={task.prompt}
        muted={!highlight}
        secondary={
          // One line tells the whole story: how it ended, what came back,
          // where it ran — instead of three stacked gray lines.
          statusWord || task.outcome || host ? (
            <>
              {statusWord}
              {statusWord && task.outcome ? " · " : ""}
              {task.outcome}
              {host && (statusWord || task.outcome) ? (
                <span className="webbutler:text-[var(--wc-text-4)]">
                  {" "}
                  · {host}
                </span>
              ) : (
                host
              )}
            </>
          ) : null
        }
      >
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
          <RowIconButton
            title="Retry"
            ariaLabel={`Retry: ${task.prompt}`}
            onClick={() => onRetry(task)}
          >
            <HiArrowPath size={11} aria-hidden />
          </RowIconButton>
        ) : null}
        {onRemove ? (
          <RowIconButton
            title="Remove"
            ariaLabel={`Remove: ${task.prompt}`}
            onClick={() => onRemove(task)}
            hoverReveal
          >
            <HiOutlineTrash size={11} aria-hidden />
          </RowIconButton>
        ) : null}
        <RowTime>{timeAgo(task.finishedAt ?? task.startedAt)}</RowTime>
      </ListRow>
    );
  };

  return (
    <ViewFrame
      label={running.length > 0 ? `${running.length} running` : "Tasks"}
      actions={
        <>
          <HeaderSearch value={query} onChange={setQuery} />
          {/* "Clear old" spares in-flight rows, so it only earns its
              place once there's history to clear. */}
          {onClear && settled.length > 0 ? (
            <HeaderAction onClick={() => onClear("old")}>
              Clear old
            </HeaderAction>
          ) : null}
          {onClear ? (
            <HeaderAction onClick={() => onClear("all")}>
              Clear all
            </HeaderAction>
          ) : null}
        </>
      }
    >
      <ViewBody>
        {shown.length === 0 ? (
          <ListNote>Nothing matches "{query.trim()}".</ListNote>
        ) : null}
        {running.length > 0 ? (
          <div className="webbutler:flex webbutler:flex-col webbutler:gap-1 webbutler:pt-1 webbutler:pb-0.5">
            {running.map((task) => (
              <LiveTaskCard
                key={task.id}
                task={task}
                onOpen={onOpenTask && (() => onOpenTask(task))}
                onRemove={onRemove && (() => onRemove(task))}
              />
            ))}
          </div>
        ) : null}
        {/* A quiet seam between what's moving and what's history. */}
        {running.length > 0 && settled.length > 0 ? (
          <div className="webbutler:flex webbutler:items-center webbutler:gap-2 webbutler:px-3 webbutler:pt-2 webbutler:pb-1">
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
      </ViewBody>
    </ViewFrame>
  );
}
