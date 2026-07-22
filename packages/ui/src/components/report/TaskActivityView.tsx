import { useEffect, useRef, useState } from 'react';
import { HiCheck, HiOutlineWrenchScrewdriver, HiXMark } from 'react-icons/hi2';
import type { Task, TaskUpdate } from '../../lib/shell';
import { BowtieMark } from '../shell/BowtieMark';
import { MarkdownLite } from '../MarkdownLite';

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
      {/* Masthead — same anatomy as ReportView's. */}
      <div className="webbutler:shrink-0 webbutler:border-b webbutler:border-[var(--wc-border-hairline)] webbutler:px-4 webbutler:pt-3.5 webbutler:pb-3">
        <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:pb-2 webbutler:text-[var(--wc-ink)]">
          <BowtieMark size={13} />
          <span className="webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
            Task
          </span>
          <span className="webbutler:flex-1" />
          <StatusBadge task={task} />
        </div>
        <h1 className="webbutler:text-[14px] webbutler:leading-snug webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
          {task.prompt}
        </h1>
        <p className="webbutler:pt-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
          {host ? `${host} · ` : ''}
          {task.scope === 'global' ? 'background' : 'this tab'} ·{' '}
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

        <div className="webbutler:flex webbutler:flex-col webbutler:gap-2.5">
          {updates.map((update, index) =>
            update.kind === 'tool' ? (
              <div
                // The feed is append-only, so index keys are stable.
                key={index}
                className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]"
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
              <p
                key={index}
                className="webbutler:text-[11px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-4)]"
              >
                {update.text}
              </p>
            ) : (
              <div key={index}>
                <MarkdownLite text={update.text} />
              </div>
            ),
          )}
        </div>

        {/* Settled: the short outcome line, when the reply didn't stream. */}
        {task.status !== 'running' &&
        task.outcome &&
        !updates.some((update) => update.kind === 'message') ? (
          <p className="webbutler:pt-2.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-ink)]">
            {task.outcome}
          </p>
        ) : null}

        {/* The task produced a report — the feed is the making-of, the
            report is the result. One tap swaps the panel over. */}
        {onOpenReport ? (
          <div className="webbutler:pt-3">
            <button
              type="button"
              onClick={onOpenReport}
              className="webbutler:cursor-pointer webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
            >
              Open report
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
