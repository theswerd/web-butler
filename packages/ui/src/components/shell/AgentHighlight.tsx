import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { HiXMark } from 'react-icons/hi2';
import type { PageHighlight } from '../../lib/shell';
import { SPRING_UI } from '../../lib/motion';
import { Markdown } from '../Markdown';

/**
 * Marker overlay for a section the AGENT flagged (PageHighlight) — the
 * counterpart to ElementHighlight, which marks what the USER picked. The
 * two speak different visual languages on purpose: picked elements wear
 * the theme accent, agent highlights read as highlighter marker — an amber
 * wash with a corner tab.
 *
 * Nothing about a highlight is proactive: it renders quietly in place and
 * the page never scrolls on its own. Focus arrives from outside (a
 * `highlight:` link in an answer/report, or the corner tab itself) and
 * brings the note card — the agent's short markdown on what this is and
 * why it's flagged.
 *
 * Same positioning discipline as ElementHighlight: an rAF loop measures
 * the target and writes transforms directly, so the box tracks scroll and
 * layout at frame rate.
 */

/** Marker palette — amber, deliberately NOT the theme accent. */
const MARKER = '#f59e0b';

const alpha = (a: number) => {
  const value = Number.parseInt(MARKER.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${a})`;
};

/** The agent's selector, resolved leniently: it wrote CSS from a snapshot,
    so a selector that throws (or matches nothing) just yields null. */
export function resolveHighlight(highlight: PageHighlight): Element | null {
  try {
    return document.querySelector(highlight.selector);
  } catch {
    return null;
  }
}

type AgentHighlightProps = {
  highlight: PageHighlight;
  /** This marker is the focused one — stronger wash, note card open. */
  focused: boolean;
  /** The corner tab (or the note's close) was clicked — the caller flips
      focus to this marker, or off when it was already focused. */
  onFocusToggle: () => void;
};

export function AgentHighlight({
  highlight,
  focused,
  onFocusToggle,
}: AgentHighlightProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let el: Element | null = null;
    let raf = 0;

    const tick = () => {
      if (!el || !el.isConnected) el = resolveHighlight(highlight);

      const box = boxRef.current;
      if (box) {
        if (el) {
          const rect = el.getBoundingClientRect();
          box.style.visibility = 'visible';
          box.style.transform = `translate(${rect.left - 3}px, ${rect.top - 3}px)`;
          box.style.width = `${rect.width + 6}px`;
          box.style.height = `${rect.height + 6}px`;
        } else {
          box.style.visibility = 'hidden';
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [highlight]);

  return (
    <motion.div
      ref={boxRef}
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        backgroundColor: focused ? alpha(0.16) : alpha(0.07),
        boxShadow: focused
          ? `0 0 0 3px ${alpha(0.18)}, 0 0 20px 2px ${alpha(0.28)}`
          : `0 0 0 0 ${alpha(0)}`,
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        top: 0,
        left: 0,
        visibility: 'hidden',
        borderColor: focused ? MARKER : alpha(0.55),
      }}
      className="webbutler:pointer-events-none webbutler:fixed webbutler:rounded-[5px] webbutler:border"
    >
      {/* Corner tab: the marker's one interactive handle. The box itself
          must stay click-through — it sits over live page content. */}
      <button
        type="button"
        aria-label={
          focused ? 'Dismiss this highlight note' : 'Show this highlight note'
        }
        onClick={onFocusToggle}
        style={{ backgroundColor: MARKER }}
        className="webbutler:pointer-events-auto webbutler:absolute webbutler:-top-2.5 webbutler:-left-2.5 webbutler:flex webbutler:size-5 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-white webbutler:shadow-sm webbutler:transition-transform webbutler:duration-100 webbutler:hover:scale-110"
      >
        {/* A marker nib, not an icon font glyph — reads at 10px. */}
        <span
          aria-hidden
          className="webbutler:size-1.5 webbutler:rounded-full webbutler:bg-white"
        />
      </button>

      {/* The note: the agent's short markdown on what this is and why.
          Only the focused marker opens it, so several highlights never
          stack cards over the page. */}
      <AnimatePresence>
        {focused && highlight.note ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING_UI}
            className="webbutler:pointer-events-auto webbutler:absolute webbutler:top-4 webbutler:left-0 webbutler:z-10 webbutler:w-[264px] webbutler:max-w-[70vw] webbutler:rounded-xl webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:shadow-lg webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150"
          >
            <div
              aria-hidden
              style={{ backgroundColor: MARKER }}
              className="webbutler:absolute webbutler:top-0 webbutler:bottom-0 webbutler:left-0 webbutler:w-[3px] webbutler:rounded-l-xl"
            />
            <div className="webbutler:flex webbutler:max-h-[180px] webbutler:items-start webbutler:gap-1.5 webbutler:overflow-y-auto webbutler:py-2 webbutler:pr-1.5 webbutler:pl-3">
              <div className="webbutler:min-w-0 webbutler:flex-1">
                <Markdown text={highlight.note} />
              </div>
              <button
                type="button"
                aria-label="Dismiss note"
                onClick={onFocusToggle}
                className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
              >
                <HiXMark size={12} aria-hidden />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
