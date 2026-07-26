import { useEffect, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  HiArrowUpRight,
  HiCheck,
  HiOutlineArrowsUpDown,
  HiOutlineCamera,
  HiOutlineChevronUpDown,
  HiOutlineCommandLine,
  HiOutlineCursorArrowRays,
  HiOutlineDocumentMagnifyingGlass,
  HiOutlineDocumentText,
  HiOutlineGlobeAlt,
  HiOutlineMap,
  HiOutlinePencilSquare,
  HiOutlinePuzzlePiece,
  HiOutlineRectangleStack,
  HiOutlineSignal,
  HiOutlineWrenchScrewdriver,
  HiXMark,
} from 'react-icons/hi2';
import type { Task, TaskUpdate } from '../../lib/shell';
import { Markdown } from '../Markdown';

/** The marker color — the user's theme accent, matching the on-page pills.
    Amber is only the fallback for hosts that never set the variable. */
const MARKER = 'var(--wc-selection, #f59e0b)';
const MARKER_EDGE = `color-mix(in srgb, ${MARKER} 45%, transparent)`;
const MARKER_WASH = `color-mix(in srgb, ${MARKER} 10%, transparent)`;

/** Per-verb icon for 'browser' feed rows, so a glance reads the act. */
const VERB_ICONS: Record<string, IconType> = {
  navigate: HiOutlineGlobeAlt,
  back: HiOutlineGlobeAlt,
  click: HiOutlineCursorArrowRays,
  type: HiOutlinePencilSquare,
  select: HiOutlineChevronUpDown,
  key: HiOutlineCommandLine,
  scroll: HiOutlineArrowsUpDown,
  screenshot: HiOutlineCamera,
  network: HiOutlineSignal,
  read: HiOutlineDocumentMagnifyingGlass,
  snapshot: HiOutlineMap,
  tabs: HiOutlineRectangleStack,
};

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

/** A settle-time output entry (report/extension): a card that opens the
    thing where it lives. Renders inert when no opener is wired (the
    output was deleted, or the panel host can't route there). */
function OutputCard({
  spacing,
  kicker,
  icon: Icon,
  title,
  detail,
  onOpen,
}: {
  spacing: string;
  kicker: string;
  icon: IconType;
  title: string;
  detail?: string;
  onOpen?: () => void;
}) {
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
      className={`webbutler:group webbutler:flex webbutler:w-full webbutler:items-center webbutler:gap-2.5 webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-3 webbutler:py-2.5 webbutler:text-left webbutler:transition-[border-color,box-shadow] webbutler:duration-100 ${
        onOpen
          ? 'webbutler:cursor-pointer webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:shadow-[inset_0_0_0_999px_var(--wc-hover-1)]'
          : ''
      } ${spacing}`}
    >
      <span
        aria-hidden
        className="webbutler:flex webbutler:size-7 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:bg-[var(--wc-accent)] webbutler:text-[var(--wc-accent-fg)]"
      >
        <Icon size={14} />
      </span>
      <span className="webbutler:min-w-0 webbutler:flex-1">
        <span className="webbutler:block webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
          {kicker}
        </span>
        <span className="webbutler:block webbutler:truncate webbutler:text-[12px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
          {title}
        </span>
        {detail ? (
          <span className="webbutler:block webbutler:truncate webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            {detail}
          </span>
        ) : null}
      </span>
      {onOpen ? (
        <HiArrowUpRight
          size={12}
          aria-hidden
          className="webbutler:shrink-0 webbutler:text-[var(--wc-text-4)] webbutler:transition-colors webbutler:duration-100 webbutler:group-hover:text-[var(--wc-ink)]"
        />
      ) : null}
    </Tag>
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
            // Rhythm: runs of actions cluster tightly (they're one burst
            // of work); a change of voice (thought, reply, user turn, a
            // result landing) opens a fuller breath of space.
            const acts = (kind: TaskUpdate['kind']) =>
              kind === 'tool' || kind === 'browser';
            const previous = index > 0 ? updates[index - 1].kind : null;
            const spacing =
              previous === null
                ? ''
                : acts(update.kind) && acts(previous)
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
            ) : update.kind === 'browser' ? (
              // A browser-control act — the same line the on-page ghost
              // cursor announced. A bare verb icon in the accent color is
              // what sets these apart from generic tool churn.
              <div
                key={index}
                className={`webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[11px] webbutler:text-[var(--wc-text-2)] ${spacing}`}
              >
                {(() => {
                  const Icon =
                    VERB_ICONS[update.verb ?? ''] ?? HiOutlineCursorArrowRays;
                  return (
                    <Icon
                      size={11}
                      aria-hidden
                      className="webbutler:shrink-0 webbutler:text-[var(--wc-selection)]"
                    />
                  );
                })()}
                <span className="webbutler:min-w-0 webbutler:truncate">
                  {update.text}
                </span>
              </div>
            ) : update.kind === 'answer' ? (
              // The reply the user saw in the tab, kept with the task.
              <div
                key={index}
                className={`webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)] webbutler:px-3 webbutler:py-2.5 ${spacing}`}
              >
                <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
                  Answer
                </p>
                <Markdown text={update.text} onHighlightLink={onHighlightLink} />
              </div>
            ) : update.kind === 'report' || update.kind === 'extension' ? (
              // A produced thing — one tap opens it where it lives.
              <OutputCard
                key={index}
                spacing={spacing}
                kicker={update.kind === 'report' ? 'Report' : 'Extension'}
                icon={
                  update.kind === 'report'
                    ? HiOutlineDocumentText
                    : HiOutlinePuzzlePiece
                }
                title={update.text}
                detail={update.detail}
                onOpen={
                  update.kind === 'report' ? onOpenReport : onOpenExtension
                }
              />
            ) : update.kind === 'highlights' ? (
              // Page markers the agent placed — the chips wear the same
              // accent as the on-page pills and focus them when clicked.
              <div key={index} className={spacing}>
                <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
                  {update.text}
                </p>
                <div className="webbutler:flex webbutler:flex-wrap webbutler:gap-1.5">
                  {(update.marks ?? []).map((mark) => (
                    <button
                      key={mark.id}
                      type="button"
                      onClick={
                        onHighlightLink
                          ? () => onHighlightLink(mark.id)
                          : undefined
                      }
                      style={{
                        borderColor: MARKER_EDGE,
                        backgroundColor: MARKER_WASH,
                      }}
                      className={`webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:border webbutler:px-2 webbutler:py-0.5 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 ${
                        onHighlightLink
                          ? 'webbutler:cursor-pointer webbutler:hover:brightness-110'
                          : 'webbutler:cursor-default'
                      }`}
                    >
                      <span
                        aria-hidden
                        style={{ backgroundColor: MARKER }}
                        className="webbutler:size-1.5 webbutler:shrink-0 webbutler:rounded-full"
                      />
                      {mark.label}
                    </button>
                  ))}
                </div>
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

        {/* Settled: the short outcome line, when the reply neither
            streamed nor landed as a structured answer entry. */}
        {task.status !== 'running' &&
        task.outcome &&
        !updates.some(
          (update) => update.kind === 'message' || update.kind === 'answer',
        ) ? (
          <p className="webbutler:pt-2.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-ink)]">
            {task.outcome}
          </p>
        ) : null}

        {/* The task's outputs, for feeds that predate the structured
            result entries — new tasks carry these as cards in the feed
            itself, and rendering both would double them up. */}
        {(onOpenReport &&
          !updates.some((update) => update.kind === 'report')) ||
        (onOpenExtension &&
          !updates.some((update) => update.kind === 'extension')) ? (
          <div className="webbutler:flex webbutler:flex-wrap webbutler:gap-1.5 webbutler:pt-3">
            {onOpenReport &&
            !updates.some((update) => update.kind === 'report') ? (
              <button
                type="button"
                onClick={onOpenReport}
                className="webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
              >
                <HiOutlineDocumentText size={12} aria-hidden />
                Open report
              </button>
            ) : null}
            {onOpenExtension &&
            !updates.some((update) => update.kind === 'extension') ? (
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
