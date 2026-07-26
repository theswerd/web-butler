import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { HiXMark } from 'react-icons/hi2';
import type { PageHighlight } from '../../lib/shell';
import { SPRING_UI } from '../../lib/motion';
import { Markdown } from '../Markdown';

/**
 * Marker overlay for a section the AGENT flagged (PageHighlight) — the
 * counterpart to ElementHighlight, which marks what the USER picked. Both
 * wear the user's selected theme accent (`accent` prop); what says "the
 * agent marked this" is the shape language — viewfinder brackets and a
 * labeled pill — not a separate color.
 *
 * Nothing about a highlight is proactive: it renders quietly in place and
 * the page never scrolls on its own. Focus arrives from outside (a
 * `highlight:` link in an answer/report, or the marker's own handle) and
 * brings the note card — the agent's short markdown on what this is and
 * why it's flagged.
 *
 * Dismissal is its own affordance, never overloaded onto "close": the
 * pill grows a ✕ on hover that removes the marker outright, and the note
 * card carries a labeled "Remove" beside its ✕ — which only ever closes
 * the note.
 *
 * Same positioning discipline as ElementHighlight: an rAF loop measures
 * the target and writes transforms directly, so the box tracks scroll and
 * layout at frame rate.
 *
 * `variant` selects the visual concept (restyling exploration — compare
 * them side by side in the AgentHighlight stories):
 *  - corners: camera-viewfinder brackets, chrome only at the corners
 *  - tag:     hairline outline with a label pill riding the top edge
 *  - dashed:  sketched dashed outline with a sticky-note paper card
 *  - glow:    borderless soft spotlight
 *  - classic: the original full border + wash
 */

/** Fallback marker color for hosts that don't pass an accent (Storybook);
    the extension feeds the user's selected theme accent instead. */
const DEFAULT_MARKER = '#f59e0b';

const withAlpha = (hex: string, a: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
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

export type AgentHighlightStyle =
  | 'classic'
  | 'corners'
  | 'corners-tag'
  | 'tag'
  | 'dashed'
  | 'glow';

/** Box chrome per concept: radius, optional real border, and the resting /
    focused fills, built from the marker color (the user's theme accent).
    The focused shadow doubles as the "look here" emphasis. */
function chromeFor(marker: string): Record<
  AgentHighlightStyle,
  {
    radius: number;
    border?: { width: number; style: 'solid' | 'dashed' };
    rest: { background: string; boxShadow: string; borderColor?: string };
    focus: { background: string; boxShadow: string; borderColor?: string };
    /** Note card treatment paired with this concept. */
    tone: NoteTone;
  }
> {
  const alpha = (a: number) => withAlpha(marker, a);
  return {
  classic: {
    radius: 5,
    border: { width: 1, style: 'solid' },
    rest: {
      background: alpha(0.07),
      boxShadow: `0 0 0 0 ${alpha(0)}`,
      borderColor: alpha(0.55),
    },
    focus: {
      background: alpha(0.16),
      boxShadow: `0 0 0 3px ${alpha(0.18)}, 0 0 20px 2px ${alpha(0.28)}`,
      borderColor: marker,
    },
    tone: 'light',
  },
  corners: {
    radius: 6,
    rest: { background: alpha(0), boxShadow: `0 0 0 0 ${alpha(0)}` },
    focus: {
      background: alpha(0.08),
      boxShadow: `0 0 0 1px ${alpha(0.3)}, 0 0 22px 2px ${alpha(0.22)}`,
    },
    tone: 'dark',
  },
  /** Corners' frame + Tag's labeled pill handle. */
  'corners-tag': {
    radius: 6,
    rest: { background: alpha(0), boxShadow: `0 0 0 0 ${alpha(0)}` },
    focus: {
      background: alpha(0.08),
      boxShadow: `0 0 0 1px ${alpha(0.3)}, 0 0 22px 2px ${alpha(0.22)}`,
    },
    tone: 'dark',
  },
  tag: {
    radius: 8,
    border: { width: 1, style: 'solid' },
    rest: {
      background: alpha(0.04),
      boxShadow: `0 0 0 0 ${alpha(0)}`,
      borderColor: alpha(0.6),
    },
    focus: {
      background: alpha(0.12),
      boxShadow: `0 0 0 3px ${alpha(0.15)}, 0 10px 30px -6px ${alpha(0.4)}`,
      borderColor: marker,
    },
    tone: 'light',
  },
  dashed: {
    radius: 8,
    border: { width: 2, style: 'dashed' },
    rest: {
      background: alpha(0),
      boxShadow: `0 0 0 0 ${alpha(0)}`,
      borderColor: alpha(0.65),
    },
    focus: {
      background: alpha(0.09),
      boxShadow: `0 0 0 3px ${alpha(0.14)}`,
      borderColor: marker,
    },
    tone: 'paper',
  },
  glow: {
    radius: 10,
    rest: {
      background: alpha(0.03),
      boxShadow: `0 0 0 1px ${alpha(0.28)}, 0 0 16px 2px ${alpha(0.18)}`,
    },
    focus: {
      background: alpha(0.1),
      boxShadow: `0 0 0 2px ${alpha(0.5)}, 0 0 34px 8px ${alpha(0.32)}`,
    },
    tone: 'light',
  },
  };
}

type AgentHighlightProps = {
  highlight: PageHighlight;
  /** This marker is the focused one — stronger emphasis, note card open. */
  focused: boolean;
  /** The marker's handle was clicked — the caller flips focus to this
      marker, or off when it was already focused. */
  onFocusToggle: () => void;
  /** Remove this marker from the page entirely (the note card's ✕). When
      omitted the ✕ merely closes the note. */
  onDismiss?: () => void;
  /** Visual concept; `classic` is the original look. */
  variant?: AgentHighlightStyle;
  /** 0-based position among this answer's highlights — numbers the tag
      pill and the note kicker when there are several. */
  index?: number;
  /** The marker color — the user's selected theme accent. Falls back to
      marker amber for hosts that don't theme (Storybook). */
  accent?: string;
};

export function AgentHighlight({
  highlight,
  focused,
  onFocusToggle,
  onDismiss,
  variant = 'classic',
  index,
  accent = DEFAULT_MARKER,
}: AgentHighlightProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const alpha = (a: number) => withAlpha(accent, a);
  const chrome = chromeFor(accent)[variant];
  const state = focused ? chrome.focus : chrome.rest;
  // The pill carries the agent's own 1-3 word name for the section;
  // numbering is only the fallback for highlights that arrived without one.
  const label =
    highlight.label?.trim() ||
    (index == null ? 'Note' : `Note ${index + 1}`);

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
        backgroundColor: state.background,
        // The glow concept breathes while focused; everything else rests.
        boxShadow:
          variant === 'glow' && focused
            ? [state.boxShadow, `0 0 0 2px ${alpha(0.4)}, 0 0 44px 12px ${alpha(0.42)}`]
            : state.boxShadow,
        ...(chrome.border ? { borderColor: state.borderColor } : {}),
      }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{
        duration: 0.15,
        boxShadow:
          variant === 'glow' && focused
            ? {
                duration: 1.1,
                repeat: Infinity,
                repeatType: 'reverse',
                ease: 'easeInOut',
              }
            : { duration: 0.15 },
      }}
      style={{
        top: 0,
        left: 0,
        visibility: 'hidden',
        borderRadius: chrome.radius,
        ...(chrome.border
          ? {
              borderWidth: chrome.border.width,
              borderStyle: chrome.border.style,
              borderColor: state.borderColor,
            }
          : {}),
      }}
      className="webbutler:pointer-events-none webbutler:fixed"
    >
      {variant === 'corners' || variant === 'corners-tag' ? (
        <CornerBrackets focused={focused} color={accent} />
      ) : null}

      {/* The marker's one interactive handle. The box itself must stay
          click-through — it sits over live page content. */}
      {variant === 'tag' || variant === 'corners-tag' ? (
        <div
          style={{ backgroundColor: accent }}
          className={`webbutler:group webbutler:pointer-events-auto webbutler:absolute webbutler:-top-[9px] webbutler:flex webbutler:h-[18px] webbutler:items-center webbutler:rounded-full webbutler:pl-2 webbutler:pr-1.5 webbutler:text-[10px] webbutler:leading-none webbutler:font-semibold webbutler:text-white webbutler:shadow-sm webbutler:transition-[filter] webbutler:duration-100 webbutler:hover:brightness-110 ${
            // Clear the top-left bracket's arm instead of colliding with it.
            variant === 'corners-tag' ? 'webbutler:left-4' : 'webbutler:left-2.5'
          }`}
        >
          <button
            type="button"
            aria-label={
              focused ? 'Hide this highlight note' : 'Show this highlight note'
            }
            onClick={onFocusToggle}
            className="webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1"
          >
            <span
              aria-hidden
              className="webbutler:size-[5px] webbutler:shrink-0 webbutler:rounded-full webbutler:bg-white"
            />
            {/* Capped so a wordy label can't sprawl a banner across the page. */}
            <span className="webbutler:max-w-[148px] webbutler:truncate">
              {label}
            </span>
          </button>
          {/* One-click dismiss, revealed on hover so the resting pill stays
              a pure label. Removes the marker; never merely closes the note. */}
          {onDismiss ? (
            <button
              type="button"
              aria-label="Remove highlight"
              onClick={onDismiss}
              className="webbutler:flex webbutler:w-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:overflow-hidden webbutler:rounded-full webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:ml-1 webbutler:group-hover:w-3.5 webbutler:group-hover:opacity-100 webbutler:hover:bg-white/25 webbutler:focus-visible:ml-1 webbutler:focus-visible:w-3.5 webbutler:focus-visible:opacity-100"
            >
              <HiXMark size={11} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          aria-label={
            focused ? 'Hide this highlight note' : 'Show this highlight note'
          }
          onClick={onFocusToggle}
          style={{
            backgroundColor: accent,
            ...(variant === 'glow'
              ? { boxShadow: `0 0 0 3px ${alpha(0.3)}` }
              : {}),
          }}
          className={`webbutler:pointer-events-auto webbutler:absolute webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:text-white webbutler:shadow-sm webbutler:transition-transform webbutler:duration-100 webbutler:hover:scale-110 ${
            variant === 'corners'
              ? 'webbutler:-top-[9px] webbutler:-left-[9px] webbutler:size-[18px] webbutler:rounded-[5px]'
              : variant === 'glow'
                ? 'webbutler:-top-2 webbutler:-left-2 webbutler:size-4 webbutler:rounded-full'
                : 'webbutler:-top-2.5 webbutler:-left-2.5 webbutler:size-5 webbutler:rounded-full'
          }`}
        >
          {/* A marker nib, not an icon font glyph — reads at 10px. */}
          <span
            aria-hidden
            className={`webbutler:rounded-full webbutler:bg-white ${
              variant === 'glow' ? 'webbutler:size-1' : 'webbutler:size-1.5'
            }`}
          />
        </button>
      )}

      {/* The note: the agent's short markdown on what this is and why.
          Only the focused marker opens it, so several highlights never
          stack cards over the page. */}
      <AnimatePresence>
        {focused && highlight.note ? (
          <NoteCard
            note={highlight.note}
            label={label}
            tone={chrome.tone}
            accent={accent}
            caret={variant === 'tag' || variant === 'corners-tag'}
            style={
              variant === 'tag'
                ? { top: 18, left: 10 }
                : variant === 'corners-tag'
                  ? { top: 18, left: 16 }
                  : { top: 16, left: 0 }
            }
            onClose={onFocusToggle}
            onRemove={onDismiss}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/** Camera-viewfinder brackets: chrome lives only at the corners, so the
    marked content stays almost entirely unframed until focus. */
function CornerBrackets({
  focused,
  color,
}: {
  focused: boolean;
  color: string;
}) {
  const size = focused ? 18 : 14;
  const common: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: 0,
    opacity: focused ? 1 : 0.85,
    transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
    pointerEvents: 'none',
  };
  return (
    <>
      <span
        aria-hidden
        style={{
          ...common,
          top: -2,
          left: -2,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderTopLeftRadius: 6,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          top: -2,
          right: -2,
          borderTopWidth: 2,
          borderRightWidth: 2,
          borderTopRightRadius: 6,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          bottom: -2,
          left: -2,
          borderBottomWidth: 2,
          borderLeftWidth: 2,
          borderBottomLeftRadius: 6,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          bottom: -2,
          right: -2,
          borderBottomWidth: 2,
          borderRightWidth: 2,
          borderBottomRightRadius: 6,
        }}
      />
    </>
  );
}

type NoteTone = 'light' | 'dark' | 'paper';

/** Card treatments. `dark` and `paper` re-skin the Markdown body by
    overriding the theme variables it draws from — the vars cascade, so no
    Markdown changes are needed. */
const TONE_STYLE: Record<NoteTone, CSSProperties> = {
  light: {},
  dark: {
    background: 'rgba(23, 23, 26, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    ['--wc-ink' as never]: '#fafafa',
    ['--wc-text-2' as never]: 'rgba(255,255,255,0.78)',
    ['--wc-text-3' as never]: 'rgba(255,255,255,0.5)',
    ['--wc-text-4' as never]: 'rgba(255,255,255,0.35)',
    ['--wc-hover-1' as never]: 'rgba(255,255,255,0.06)',
    ['--wc-hover-2' as never]: 'rgba(255,255,255,0.1)',
    ['--wc-border' as never]: 'rgba(255,255,255,0.14)',
    ['--wc-border-hairline' as never]: 'rgba(255,255,255,0.1)',
    ['--wc-border-soft' as never]: 'rgba(255,255,255,0.08)',
    ['--wc-border-strong' as never]: 'rgba(255,255,255,0.28)',
  },
  paper: {
    background: '#fffbeb',
    borderColor: '#eeddad',
    ['--wc-ink' as never]: '#451a03',
    ['--wc-text-2' as never]: '#6b4a12',
    ['--wc-text-3' as never]: '#a16207',
    ['--wc-text-4' as never]: '#c8a24a',
    ['--wc-hover-1' as never]: 'rgba(180,120,20,0.08)',
    ['--wc-hover-2' as never]: 'rgba(180,120,20,0.14)',
    ['--wc-border' as never]: '#eeddad',
    ['--wc-border-hairline' as never]: '#f2e5bd',
    ['--wc-border-soft' as never]: '#f6ecce',
    ['--wc-border-strong' as never]: '#dfc27a',
  },
};

function NoteCard({
  note,
  label,
  tone,
  caret,
  style,
  onClose,
  onRemove,
  accent,
}: {
  note: string;
  label: string;
  tone: NoteTone;
  /** Marker color for the kicker glyph — matches the frame outside. */
  accent: string;
  /** Draw a small caret at the top-left, pointing up at the tag pill. */
  caret: boolean;
  style: CSSProperties;
  /** The ✕ — closes the note, nothing more. */
  onClose: () => void;
  /** The labeled "Remove" action — dismisses the marker entirely. */
  onRemove?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={SPRING_UI}
      style={style}
      className="webbutler:pointer-events-auto webbutler:absolute webbutler:z-10 webbutler:w-[272px] webbutler:max-w-[70vw]"
    >
      {caret ? (
        <span
          aria-hidden
          style={{
            ...TONE_STYLE[tone],
            background:
              (TONE_STYLE[tone].background as string) ?? 'var(--wc-surface)',
          }}
          className="webbutler:absolute webbutler:-top-1 webbutler:left-4 webbutler:z-10 webbutler:size-2 webbutler:rotate-45 webbutler:border-t webbutler:border-l webbutler:border-[var(--wc-border)]"
        />
      ) : null}
      <div
        style={TONE_STYLE[tone]}
        className={`webbutler:relative webbutler:rounded-[10px] webbutler:border webbutler:shadow-lg ${
          tone === 'light'
            ? 'webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150'
            : tone === 'dark'
              ? 'webbutler:backdrop-blur-xl'
              : ''
        }`}
      >
        <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:px-2.5 webbutler:pt-2 webbutler:pb-1">
          <span
            aria-hidden
            style={{ backgroundColor: accent }}
            className="webbutler:size-[7px] webbutler:rounded-[2px]"
          />
          <span className="webbutler:text-[9px] webbutler:font-semibold webbutler:tracking-[0.12em] webbutler:text-[var(--wc-text-3)] webbutler:uppercase">
            {label}
          </span>
          <span className="webbutler:flex-1" />
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="webbutler:h-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-md webbutler:px-1.5 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
            >
              Remove
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close note"
            onClick={onClose}
            className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
          >
            <HiXMark size={12} aria-hidden />
          </button>
        </div>
        <div className="webbutler:max-h-[190px] webbutler:overflow-y-auto webbutler:px-2.5 webbutler:pb-2.5">
          <Markdown text={note} />
        </div>
      </div>
    </motion.div>
  );
}
