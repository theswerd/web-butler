import { useEffect, useRef, useState } from 'react';
import {
  HiArrowUpRight,
  HiCheck,
  HiOutlineDocumentText,
  HiOutlinePuzzlePiece,
  HiOutlineWrenchScrewdriver,
  HiXMark,
} from 'react-icons/hi2';
import type { Task, TaskUpdate } from '../../lib/shell';
import { Markdown } from '../Markdown';

/**
 * Side-panel surface for one task's live activity: the prompt up top, the
 * agent's streamed work below — tool actions as rows, thinking as dim
 * prose, the reply as it forms. Opened from a running task's row in the
 * Tasks list; keeps rendering after the task settles (status header flips,
 * outcome line lands) so finishing doesn't yank the view away.
 *
 * The side panel entrypoint owns the data (PANEL_GET / PANEL_CHANGED);
 * this component just renders it.
 */
export type TaskActivityViewProps = {
  task: Task;
  updates: TaskUpdate[];
  /** Set when the task produced a report — renders an "Open report"
      action that swaps the panel over to it. */
  onOpenReport?: () => void;
  /** Set when the task installed/updated an extension — renders a "View
      extension" action that reveals it in the shell's Extensions view. */
  onOpenExtension?: () => void;
  /** A "suggested next" chip was tapped — the shell prefills its prompt
      with the suggestion so the user can send (or edit) it. */
  onUseSuggestion?: (text: string) => void;
  /** A `highlight:` link in an activity message was clicked — relayed to
      the active tab's shell, where the marker lives. */
  onHighlightLink?: (id: string) => void;
};

/** "0:42", "12:04" — elapsed while running, final duration once settled. */
function elapsedLabel(task: Task, now: number): string {
  const end = task.finishedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function StatusBadge({ task }: { task: Task }) {
  if (task.status === 'running') {
    return (
      <span className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-selection)]">
        <span
          aria-hidden
          className="webbutler:size-1.5 webbutler:animate-pulse webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
        />
        Working
      </span>
    );
  }
  const label =
    task.status === 'done'
      ? 'Done'
      : task.status === 'failed'
        ? 'Failed'
        : 'Stopped';
  const tone =
    task.status === 'done'
      ? 'webbutler:text-[var(--wc-selection)]'
      : task.status === 'failed'
        ? 'webbutler:text-[#e5484d]'
        : 'webbutler:text-[var(--wc-text-3)]';
  const Icon = task.status === 'done' ? HiCheck : HiXMark;
  return (
    <span
      className={`webbutler:flex webbutler:items-center webbutler:gap-1 webbutler:text-[10px] webbutler:font-medium ${tone}`}
    >
      <Icon size={11} aria-hidden />
      {label}
    </span>
  );
}

export function TaskActivityView({
  task,
  updates,
  onOpenReport,
  onOpenExtension,
  onUseSuggestion,
  onHighlightLink,
}: TaskActivityViewProps) {
  // Tick each second while running so the elapsed clock moves.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (task.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [task.status]);

  // Follow the feed while it grows — unless the user scrolled back up.
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const body = bodyRef.current;
    if (body && pinnedRef.current) body.scrollTop = body.scrollHeight;
  }, [updates.length, task.status]);

  const host = (() => {
    try {
      return new URL(task.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col webbutler:bg-[var(--wc-surface-solid)]">
      {/* Masthead: the prompt IS the header — no brand row above it. The
          status badge sits inline with the title, top-aligned so it stays
          put when a long prompt wraps. */}
      <div className="webbutler:shrink-0 webbutler:border-b webbutler:border-[var(--wc-border-hairline)] webbutler:px-4 webbutler:pt-3.5 webbutler:pb-3">
        <div className="webbutler:flex webbutler:items-start webbutler:gap-2">
          <h1 className="webbutler:min-w-0 webbutler:flex-1 webbutler:text-[14px] webbutler:leading-snug webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
            {task.prompt}
          </h1>
          {/* Nudged down to center against the title's first line. */}
          <span className="webbutler:shrink-0 webbutler:pt-[3px]">
            <StatusBadge task={task} />
          </span>
        </div>
        <p className="webbutler:pt-0.5 webbutler:text-[10px] webbutler:tabular-nums webbutler:text-[var(--wc-text-4)]">
          {host ? `${host} · ` : ''}
          {elapsedLabel(task, now)}
        </p>
      </div>

      {/* Activity feed */}
      <div
        ref={bodyRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:px-4 webbutler:py-3"
      >
        {updates.length === 0 && task.status === 'running' ? (
          <p className="webbutler:animate-pulse webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]">
            Starting up. The agent's work will stream here.
          </p>
        ) : updates.length === 0 && !task.outcome ? (
          <p className="webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]">
            No activity was recorded for this task.
          </p>
        ) : null}

        <div className="webbutler:flex webbutler:flex-col">
          {updates.map((update, index) => {
            // Rhythm: runs of tool actions cluster tightly (they're one
            // burst of work); a change of voice (thought, reply, user
            // turn) opens a fuller breath of space.
            const previous = index > 0 ? updates[index - 1].kind : null;
            const spacing =
              previous === null
                ? ''
                : update.kind === 'tool' && previous === 'tool'
                  ? 'webbutler:mt-1.5'
                  : 'webbutler:mt-3';
            return update.kind === 'tool' ? (
              <div
                // The feed is append-only, so index keys are stable.
                key={index}
                className={`webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)] ${spacing}`}
              >
                <HiOutlineWrenchScrewdriver
                  size={11}
                  aria-hidden
                  className="webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
                />
                <span className="webbutler:min-w-0 webbutler:truncate">
                  {update.text}
                </span>
              </div>
            ) : update.kind === 'thought' ? (
              // Reasoning reads as an aside: dimmest text behind a
              // hairline rule, clearly not part of the reply.
              <p
                key={index}
                className={`webbutler:border-l webbutler:border-[var(--wc-border-hairline)] webbutler:pl-2.5 webbutler:text-[11px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-4)] ${spacing}`}
              >
                {update.text}
              </p>
            ) : update.kind === 'user' ? (
              // A follow-up the user added onto the running task — set off
              // like a chat bubble so the conversation's turns are legible.
              <div
                key={index}
                className={`webbutler:max-w-[85%] webbutler:self-end webbutler:whitespace-pre-wrap webbutler:break-words webbutler:rounded-2xl webbutler:rounded-br-md webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)] webbutler:px-3 webbutler:py-1.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-ink)] ${spacing}`}
              >
                {update.text}
              </div>
            ) : (
              <div key={index} className={spacing}>
                <Markdown text={update.text} onHighlightLink={onHighlightLink} />
              </div>
            );
          })}
        </div>

        {/* Settled: the short outcome line, when the reply didn't stream. */}
        {task.status !== 'running' &&
        task.outcome &&
        !updates.some((update) => update.kind === 'message') ? (
          <p className="webbutler:pt-2.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-ink)]">
            {task.outcome}
          </p>
        ) : null}

        {/* The task's outputs — the feed is the making-of, these are the
            results. One tap opens each. */}
        {onOpenReport || onOpenExtension ? (
          <div className="webbutler:flex webbutler:flex-wrap webbutler:gap-1.5 webbutler:pt-3">
            {onOpenReport ? (
              <button
                type="button"
                onClick={onOpenReport}
                className="webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
              >
                <HiOutlineDocumentText size={12} aria-hidden />
                Open report
              </button>
            ) : null}
            {onOpenExtension ? (
              <button
                type="button"
                onClick={onOpenExtension}
                className={`webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:transition-shadow webbutler:duration-100 ${
                  onOpenReport
                    ? // Secondary next to the report button; the headline
                      // when it's the task's only output.
                      'webbutler:border webbutler:border-[var(--wc-border)] webbutler:text-[var(--wc-ink)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]'
                    : 'webbutler:bg-[var(--wc-accent)] webbutler:text-[var(--wc-accent-fg)] webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]'
                }`}
              >
                <HiOutlinePuzzlePiece size={12} aria-hidden />
                View extension
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Where to go from here — the agent's suggested follow-ups, one
            tap each to prefill the shell's prompt. Settled tasks only:
            while running they'd be stale before they landed. */}
        {task.status !== 'running' &&
        onUseSuggestion &&
        task.suggestions &&
        task.suggestions.length > 0 ? (
          <div className="webbutler:pt-4">
            <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
              Suggested next
            </p>
            <div className="webbutler:flex webbutler:flex-col webbutler:items-start webbutler:gap-1.5">
              {task.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onUseSuggestion(suggestion)}
                  className="webbutler:flex webbutler:max-w-full webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2.5 webbutler:py-1 webbutler:text-left webbutler:text-[11px] webbutler:leading-4 webbutler:text-[var(--wc-text-2)] webbutler:transition-[border-color,box-shadow,color] webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:text-[var(--wc-ink)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]"
                >
                  <HiArrowUpRight
                    size={10}
                    aria-hidden
                    className="webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
                  />
                  <span className="webbutler:min-w-0 webbutler:truncate">
                    {suggestion}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
