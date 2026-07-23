import { AnimatePresence, motion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import {
  HiArrowPath,
  HiArrowTopRightOnSquare,
  HiCheck,
  HiClipboard,
  HiDocumentText,
  HiExclamationTriangle,
  HiOutlinePuzzlePiece,
  HiXMark,
} from 'react-icons/hi2';
import { SPRING_UI } from '../../lib/motion';
import { Markdown } from '../Markdown';
import { hostsLabel, Toggle } from './views/ExtensionsView';

/**
 * Answer surfaces — where prompt output lands when it isn't (only) a page
 * side effect. Three tiers, one component:
 *
 *  - 'status'   one-line confirmation of a side effect ("Header set to
 *               dark."). A pill, not a panel — glance and go. The shell
 *               auto-dismisses it after a few seconds.
 *  - 'answer'   short/medium prose answers. A chromeless card capped at
 *               menu height; content scrolls inside, markdown-lite. Copy
 *               and dismiss float in the corner, revealed on hover/focus.
 *               Can carry follow-ups: hint chips (`hints`) that prefill
 *               the prompt, or multiple-choice options (`choices`) when
 *               the agent needs a decision before acting.
 *  - 'artifact' serious, long-form reports. These do NOT render in-page —
 *               they live in the Chrome side panel (chrome.sidePanel).
 *               In-page, this tier is a compact handoff card: title +
 *               "Open report", which the shell wires to opening the panel.
 *  - 'extension' a site extension was installed/updated. Declarative, not
 *               triumphant: the card states what now exists (name, what it
 *               does, which sites) plus whether Chrome will actually run
 *               it — that isn't knowable at generation time, so the card
 *               reads the live `scriptingAllowed` flag: a green "active"
 *               line when scripts are allowed, or an explicit "not running
 *               yet" warning with an allow-scripting button when not.
 *  - 'error'    the run failed. Unmistakably not a success (no checkmark,
 *               red mark, "Something went wrong" heading) and actionable:
 *               Try again re-sends the same prompt, Switch provider jumps
 *               to the Providers view for when the failure is the AI side.
 *
 * All tiers mount in the same anchored slot the menu panel uses — above the
 * prompt when docked at the bottom, below when docked at the top — so answers
 * never reflow the pill. The report body itself renders via ReportView.
 */
export type { AnswerTier } from '../../lib/shell';
import type { AnswerTier } from '../../lib/shell';

export type AnswerCardProps = {
  tier: AnswerTier;
  /** Markdown (GFM): tables, images, task lists, code, and the rest.
      Extension tier: the verb — "Installed" or "Updated". */
  text: string;
  /** Artifact name on the handoff card / the extension's name. */
  title?: string;
  /** Artifact one-liner / what the extension does. */
  description?: string;
  /** Extension tier: the match patterns it covers (rendered as hosts). */
  urlPatterns?: string[];
  /** Extension tier: can Chrome inject it right now? (Live — the user can
      flip the switch while this card is up and it turns green.) */
  scriptingAllowed?: boolean;
  /** Extension tier: the extension's on/off state, live from the shell. */
  extensionEnabled?: boolean;
  /** Extension tier: the card's switch was flipped. */
  onExtensionToggle?: (enabled: boolean) => void;
  /** Extension tier: "Allow in Chrome settings" clicked — the shell opens
      chrome://extensions with the switch highlighted. */
  onAllowScripting?: () => void;
  /** Answer tier: suggested follow-up prompts, rendered as chips. */
  hints?: string[];
  /** A hint chip was clicked — the shell prefills the prompt with it. */
  onHint?: (hint: string) => void;
  /** Answer tier: multiple-choice follow-up options (agent asks, user picks). */
  choices?: string[];
  /**
   * 'single' (default): radio rows — picking swaps the selection. 'multi':
   * checkbox rows — picking toggles. Either way nothing sends until the
   * submit button; picking is never a reply on its own.
   */
  choiceMode?: 'single' | 'multi';
  /** Submit button label; defaults to 'Submit'. */
  choiceSubmitLabel?: string;
  /**
   * Submit button pressed — the current selection, in display order.
   * Submitting also closes the card (fires `onDismiss` first).
   */
  onSubmitChoices?: (choices: string[]) => void;
  /** Artifact tier only: open the report in the side panel. */
  onOpenReport?: () => void;
  /** Error tier: re-send the failed prompt. */
  onRetry?: () => void;
  /** Error tier: open the Providers view — maybe another AI can. */
  onSwitchProvider?: () => void;
  onDismiss?: () => void;
};

export function AnswerCard({
  tier,
  text,
  title,
  description,
  urlPatterns,
  scriptingAllowed,
  extensionEnabled,
  onExtensionToggle,
  onAllowScripting,
  hints,
  onHint,
  choices,
  choiceMode = 'single',
  choiceSubmitLabel,
  onSubmitChoices,
  onOpenReport,
  onRetry,
  onSwitchProvider,
  onDismiss,
}: AnswerCardProps) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const multi = choiceMode === 'multi';
  const hasChoices = (choices?.length ?? 0) > 0;
  const submitLabel = choiceSubmitLabel ?? 'Submit';
  // Per-card layoutId: two cards on screen must not share a sliding dot.
  const dotLayoutId = `wc-choice-dot-${useId()}`;

  // Picking only stages the selection — submit is what replies.
  const pick = (choice: string) => {
    if (multi) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(choice)) next.delete(choice);
        else next.add(choice);
        return next;
      });
      return;
    }
    setSelected(new Set([choice]));
  };

  // Submitting is a reply — the card's job is done, so it closes itself.
  // Dismiss fires first so a shell that starts the next run on submit
  // doesn't have that fresh run cleared by a trailing dismiss.
  const submitChoices = () => {
    if (selected.size === 0) return;
    onDismiss?.();
    onSubmitChoices?.((choices ?? []).filter((choice) => selected.has(choice)));
  };

  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (tier === 'error') {
    return (
      <div className="webbutler:w-full webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:px-3.5 webbutler:py-3 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150">
        <div className="webbutler:flex webbutler:items-start webbutler:gap-2.5">
          <span className="webbutler:flex webbutler:size-7 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-lg webbutler:bg-[rgba(229,72,77,0.12)] webbutler:text-[#e5484d]">
            <HiExclamationTriangle size={15} aria-hidden />
          </span>
          <div className="webbutler:min-w-0 webbutler:flex-1">
            <p className="webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
              Something went wrong
            </p>
            {/* The raw failure, dim: useful for debugging, not the message. */}
            <p className="webbutler:pt-0.5 webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-3)]">
              {text}
            </p>
          </div>
          <IconButton label="Dismiss" onClick={onDismiss}>
            <HiXMark size={12} aria-hidden />
          </IconButton>
        </div>
        <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:pt-2.5">
          {onRetry ? (
            <button
              type="button"
              autoFocus
              onClick={onRetry}
              className="webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
            >
              <HiArrowPath size={11} aria-hidden />
              Try again
            </button>
          ) : null}
          {onSwitchProvider ? (
            <button
              type="button"
              onClick={onSwitchProvider}
              className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-2.5 webbutler:py-1 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]"
            >
              Switch provider
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (tier === 'status') {
    return (
      <div className="webbutler:flex webbutler:w-full webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:py-1.5 webbutler:pr-2 webbutler:pl-3 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150">
        <HiCheck
          size={13}
          aria-hidden
          className="webbutler:shrink-0 webbutler:text-[var(--wc-selection)]"
        />
        <span className="webbutler:min-w-0 webbutler:flex-1 webbutler:truncate webbutler:text-[12px] webbutler:text-[var(--wc-ink)]">
          {text}
        </span>
        <IconButton label="Dismiss" onClick={onDismiss}>
          <HiXMark size={12} aria-hidden />
        </IconButton>
      </div>
    );
  }

  if (tier === 'artifact') {
    // Handoff, not content: the report renders in the side panel.
    return (
      <div className="webbutler:flex webbutler:w-full webbutler:items-center webbutler:gap-2.5 webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:py-2.5 webbutler:pr-2 webbutler:pl-3 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150">
        <span className="webbutler:flex webbutler:size-7 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-lg webbutler:bg-[var(--wc-hover-1)] webbutler:text-[var(--wc-selection)]">
          <HiDocumentText size={15} aria-hidden />
        </span>
        <div className="webbutler:min-w-0 webbutler:flex-1">
          <p className="webbutler:truncate webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
            {title ?? 'Report'}
          </p>
          <p className="webbutler:truncate webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
            {description ?? 'Report ready. Opens in the side panel.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenReport}
          className="webbutler:flex webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:gap-1 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2.5 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
        >
          Open
          <HiArrowTopRightOnSquare size={11} aria-hidden />
        </button>
        <IconButton label="Dismiss" onClick={onDismiss}>
          <HiXMark size={12} aria-hidden />
        </IconButton>
      </div>
    );
  }

  if (tier === 'extension') {
    const hosts = hostsLabel(urlPatterns ?? []);
    const enabled = extensionEnabled ?? true; // installs land enabled
    return (
      <div className="webbutler:w-full webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:px-3.5 webbutler:py-3 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150">
        <div className="webbutler:flex webbutler:items-start webbutler:gap-2.5">
          <span className="webbutler:flex webbutler:size-7 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-lg webbutler:bg-[var(--wc-hover-1)] webbutler:text-[var(--wc-selection)]">
            <HiOutlinePuzzlePiece size={15} aria-hidden />
          </span>
          <div className="webbutler:min-w-0 webbutler:flex-1">
            <p className="webbutler:truncate webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
              {title ?? 'Site extension'}
            </p>
            <p className="webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-3)]">
              {description}
            </p>
            <p className="webbutler:pt-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
              {text} extension{hosts ? ` · applies on ${hosts}` : ''} · manage
              it under Extensions in the menu
            </p>
          </div>
          {/* The same switch as the Extensions view row — turning the fresh
              install off (or back on) shouldn't require a trip through the
              menu. Open tabs revert/reapply immediately. */}
          {onExtensionToggle ? (
            <span className="webbutler:pt-1">
              <Toggle
                on={enabled}
                label={`${enabled ? 'Disable' : 'Enable'} ${title ?? 'extension'}`}
                onChange={onExtensionToggle}
              />
            </span>
          ) : null}
          <IconButton label="Dismiss" onClick={onDismiss}>
            <HiXMark size={12} aria-hidden />
          </IconButton>
        </div>

        {/* The honest part: saved ≠ running. Chrome decides at injection
            time, so this row reads the live flags and updates in place as
            the user flips either switch. */}
        {scriptingAllowed && enabled ? (
          <div className="webbutler:mt-2.5 webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            <span
              aria-hidden
              className="webbutler:size-1.5 webbutler:shrink-0 webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
            />
            Active now{hosts ? ` on ${hosts}` : ''}.
          </div>
        ) : scriptingAllowed ? (
          <div className="webbutler:mt-2.5 webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            <span
              aria-hidden
              className="webbutler:size-1.5 webbutler:shrink-0 webbutler:rounded-full webbutler:bg-[var(--wc-text-4)]"
            />
            Turned off. Flip the switch to run it.
          </div>
        ) : (
          <div className="webbutler:mt-2.5 webbutler:flex webbutler:items-start webbutler:gap-2 webbutler:rounded-md webbutler:bg-[rgba(245,158,11,0.12)] webbutler:px-2.5 webbutler:py-2">
            <HiExclamationTriangle
              size={13}
              aria-hidden
              className="webbutler:mt-px webbutler:shrink-0 webbutler:text-[#F59E0B]"
            />
            <div className="webbutler:min-w-0 webbutler:flex-1">
              <p className="webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-2)]">
                Saved, but not running yet: Chrome blocks Web Butler's page
                scripts until you allow them.
              </p>
              <button
                type="button"
                onClick={onAllowScripting}
                className="webbutler:mt-1.5 webbutler:cursor-pointer webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-2.5 webbutler:py-1 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
              >
                Allow in Chrome settings
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHovered(false);
        }
      }}
      className="webbutler:relative webbutler:w-full webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150"
    >
      {/* Body — chromeless; scrolls inside the capped frame. */}
      <div className="webbutler:max-h-[188px] webbutler:overflow-y-auto webbutler:px-3.5 webbutler:py-2.5">
        <Markdown text={text} />

        {/* Multiple-choice follow-up: the agent needs a decision to act.
            Same selection language as the settings panel: quiet rows, no
            radio/checkbox glyphs. Single = one accent dot that slides
            between rows; multi = a check that settles in on the right. */}
        {choices && choices.length > 0 ? (
          <div
            role={multi ? 'group' : 'radiogroup'}
            className="webbutler:flex webbutler:flex-col webbutler:gap-1 webbutler:pt-2.5"
          >
            {choices.map((choice) => {
              const isChosen = selected.has(choice);
              return (
                <button
                  key={choice}
                  type="button"
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={isChosen}
                  onClick={() => pick(choice)}
                  // Hairline border at rest so rows read as tappable options
                  // before any hover; selection adds the fill + dot/check.
                  className={`webbutler:relative webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-2 webbutler:rounded-lg webbutler:border webbutler:py-1.5 webbutler:pr-2.5 webbutler:text-left webbutler:text-[12px] webbutler:transition-colors webbutler:duration-100 ${
                    multi ? 'webbutler:pl-2.5' : 'webbutler:pl-6'
                  } ${
                    isChosen
                      ? 'webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-hover-1)] webbutler:font-medium webbutler:text-[var(--wc-ink)]'
                      : 'webbutler:border-[var(--wc-border-hairline)] webbutler:text-[var(--wc-text-2)] webbutler:hover:border-[var(--wc-border)] webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]'
                  }`}
                >
                  {!multi && isChosen ? (
                    <motion.span
                      layoutId={dotLayoutId}
                      transition={SPRING_UI}
                      className="webbutler:absolute webbutler:top-1/2 webbutler:left-2.5 webbutler:size-1.5 webbutler:-translate-y-1/2 webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
                    />
                  ) : null}
                  <span className="webbutler:min-w-0 webbutler:flex-1 webbutler:truncate">
                    {choice}
                  </span>
                  {multi ? (
                    <AnimatePresence initial={false}>
                      {isChosen ? (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={SPRING_UI}
                          className="webbutler:shrink-0 webbutler:text-[var(--wc-selection)]"
                        >
                          <HiCheck size={12} aria-hidden />
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  ) : null}
                </button>
              );
            })}

            <div className="webbutler:flex webbutler:justify-end webbutler:pt-1">
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={submitChoices}
                className={`webbutler:rounded-full webbutler:px-3 webbutler:py-1 webbutler:text-[11px] webbutler:font-medium webbutler:transition-colors webbutler:duration-100 ${
                  selected.size === 0
                    ? 'webbutler:bg-[var(--wc-hover-1)] webbutler:text-[var(--wc-text-4)]'
                    : 'webbutler:cursor-pointer webbutler:bg-[var(--wc-accent)] webbutler:text-[var(--wc-accent-fg)] webbutler:hover:opacity-90'
                }`}
              >
                {submitLabel}
              </button>
            </div>
          </div>
        ) : null}

        {/* Prompt hints: one-tap follow-ups that prefill the input. */}
        {hints && hints.length > 0 ? (
          <div className="webbutler:flex webbutler:flex-wrap webbutler:gap-1.5 webbutler:pt-2.5">
            {hints.map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => onHint?.(hint)}
                className="webbutler:cursor-pointer webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:px-2.5 webbutler:py-1 webbutler:text-[11px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border)] webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]"
              >
                {hint}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Floating actions — no header bar; revealed on hover/focus. */}
      <div
        className={`webbutler:absolute webbutler:top-1.5 webbutler:right-1.5 webbutler:flex webbutler:gap-0.5 webbutler:rounded-lg webbutler:bg-[var(--wc-surface)] webbutler:p-0.5 webbutler:backdrop-blur-md webbutler:transition-opacity webbutler:duration-100 ${
          hovered ? 'webbutler:opacity-100' : 'webbutler:opacity-0'
        }`}
      >
        {/* Choice follow-ups are a question, not content — nothing to copy. */}
        {!hasChoices ? (
          <IconButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
            {copied ? (
              <HiCheck size={12} aria-hidden className="webbutler:text-[var(--wc-selection)]" />
            ) : (
              <HiClipboard size={12} aria-hidden />
            )}
          </IconButton>
        ) : null}
        <IconButton label="Dismiss" onClick={onDismiss}>
          <HiXMark size={12} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
    >
      {children}
    </button>
  );
}
