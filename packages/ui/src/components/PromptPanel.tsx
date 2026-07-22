import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { HiViewfinderCircle } from 'react-icons/hi2';
import { sendHopKeyframes, SPRING_UI } from '../lib/motion';
import {
  PromptInput,
  PromptInputAction,
  PromptInputTextarea,
} from './prompt-input/PromptInput';

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 11.5V2.5M7 2.5L3.25 6.25M7 2.5L10.75 6.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** Cycles "", ".", "..", "..." while a send is in flight. */
function useWorkingDots(active: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const id = window.setInterval(() => {
      setCount((current) => (current + 1) % 4);
    }, 420);
    return () => window.clearInterval(id);
  }, [active]);

  return '.'.repeat(count);
}

type PromptPanelProps = {
  leading?: ReactNode;
  /** Controlled draft text — owned by the shell so it can be persisted. */
  value: string;
  onValueChange: (value: string) => void;
  /** Focus the input when the panel mounts (used when opened via shortcut). */
  autoFocus?: boolean;
  /** External handle to the textarea, for programmatic focus from the shell. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** ArrowLeft with the caret at position 0 — focus walks to the menu button. */
  onArrowLeftAtStart?: () => void;
  /** Fired with the trimmed text when a message is sent. */
  onSubmit?: (text: string) => void;
  /**
   * Controlled working state: when set, the run's owner (the background
   * script, via the shell) decides when the shimmer starts and stops. When
   * omitted, the panel self-drives a 10s mock after each send.
   */
  loading?: boolean;
  /** Stop pressed while loading is controlled. */
  onStop?: () => void;
  /** Element picker button state + toggle. */
  pickerActive?: boolean;
  onTogglePicker?: () => void;
};

export function PromptPanel({
  leading,
  value,
  onValueChange,
  autoFocus = false,
  inputRef,
  onArrowLeftAtStart,
  onSubmit,
  loading,
  onStop,
  pickerActive = false,
  onTogglePicker,
}: PromptPanelProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  // Controlled when the shell passes `loading`; self-driven mock otherwise.
  const isLoading = loading ?? internalLoading;
  // The just-sent text, echoed as a ghost that floats up out of the box.
  const [ghost, setGhost] = useState<string | null>(null);
  const sendControls = useAnimationControls();
  const workingDots = useWorkingDots(isLoading);

  const canSubmit = value.trim().length > 0 && !isLoading;

  const handleSubmit = () => {
    if (!canSubmit) return;

    // Little hop: up, then settle back down.
    void sendControls.start(sendHopKeyframes);

    const text = value.trim();
    onSubmit?.(text);

    // Clear immediately; the ghost overlay carries the text out visually.
    onValueChange('');
    setGhost(text);

    if (loading === undefined) {
      setInternalLoading(true);
      // Uncontrolled mock (Storybook): shimmer for a fixed beat.
      window.setTimeout(() => setInternalLoading(false), 10_000);
    }
  };

  const handleStop = () => {
    if (loading === undefined) setInternalLoading(false);
    else onStop?.();
  };

  return (
    <div className="webbutler:flex webbutler:w-full webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150 webbutler:py-1.5 webbutler:pr-2 webbutler:pl-2 webbutler:focus-within:border-[var(--wc-focus-border)] webbutler:focus-within:ring-[3px] webbutler:focus-within:ring-[var(--wc-ring)]">
      {leading}

      <PromptInput
        value={value}
        onValueChange={onValueChange}
        isLoading={isLoading}
        maxHeight={24}
        onSubmit={handleSubmit}
        textareaRef={inputRef}
        className="webbutler:min-w-0 webbutler:flex-1"
      >
        {/* Flex so the textarea centers exactly as it did as a direct flex
            child — a plain block wrapper leaves it baseline-aligned (high). */}
        <div className="webbutler:relative webbutler:flex webbutler:min-w-0 webbutler:flex-1 webbutler:items-center">
          <PromptInputTextarea
            placeholder={
              isLoading
                ? ''
                : pickerActive
                  ? 'Select an element · shift-click picks several…'
                  : 'Ask Web Butler…'
            }
            disableAutosize
            rows={1}
            autoFocus={autoFocus}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft') return;
              const el = event.currentTarget;
              if (el.selectionStart === 0 && el.selectionEnd === 0) {
                event.preventDefault();
                onArrowLeftAtStart?.();
              }
            }}
          />

          {/* Sent text floats up and out of the (already cleared) box. */}
          <AnimatePresence>
            {ghost !== null ? (
              <motion.span
                key={ghost}
                initial={{ opacity: 1, y: 0 }}
                animate={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onAnimationComplete={() => setGhost(null)}
                className="webbutler:pointer-events-none webbutler:absolute webbutler:inset-0 webbutler:flex webbutler:items-center webbutler:overflow-hidden webbutler:text-[13px] webbutler:whitespace-nowrap webbutler:text-[var(--wc-ink)]"
              >
                {ghost}
              </motion.span>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {isLoading && value.length === 0 ? (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, backgroundPosition: ['200% 0', '-200% 0'] }}
                exit={{ opacity: 0 }}
                transition={{
                  opacity: { duration: 0.15 },
                  backgroundPosition: {
                    duration: 6.75,
                    repeat: Infinity,
                    ease: 'linear',
                  },
                }}
                className="webbutler:pointer-events-none webbutler:absolute webbutler:inset-0 webbutler:flex webbutler:items-center webbutler:text-[13px] webbutler:whitespace-nowrap"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, var(--wc-text-4) 20%, var(--wc-ink) 50%, var(--wc-text-4) 80%)',
                  backgroundSize: '200% 100%',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Working{workingDots}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        <PromptInputAction tooltip={pickerActive ? 'Cancel selection' : 'Select element on page'}>
          <button
            type="button"
            aria-label={pickerActive ? 'Cancel element selection' : 'Select element on page'}
            aria-pressed={pickerActive}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePicker?.();
            }}
            className={`webbutler:inline-flex webbutler:size-6 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:transition-colors webbutler:duration-100 webbutler:outline-none webbutler:focus-visible:ring-2 webbutler:focus-visible:ring-[var(--wc-ring-strong)] ${
              pickerActive
                ? 'webbutler:bg-[var(--wc-hover-2)] webbutler:text-[var(--wc-selection)]'
                : 'webbutler:text-[var(--wc-text-3)] webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]'
            }`}
          >
            <HiViewfinderCircle size={14} aria-hidden />
          </button>
        </PromptInputAction>

        <PromptInputAction tooltip={isLoading ? 'Stop' : 'Send'}>
          <motion.button
            type="button"
            aria-label={isLoading ? 'Stop' : 'Send'}
            disabled={!isLoading && !canSubmit}
            animate={sendControls}
            whileTap={{ scale: 0.88 }}
            transition={SPRING_UI}
            onClick={(event) => {
              event.stopPropagation();
              if (isLoading) {
                handleStop();
                return;
              }
              handleSubmit();
            }}
            className="webbutler:ml-1 webbutler:inline-flex webbutler:size-6 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:text-[var(--wc-accent-fg)] webbutler:transition-opacity webbutler:outline-none webbutler:hover:opacity-85 webbutler:disabled:opacity-100 webbutler:focus-visible:ring-2 webbutler:focus-visible:ring-[var(--wc-ring-strong)] webbutler:focus-visible:ring-offset-2 webbutler:focus-visible:ring-offset-[var(--wc-surface-solid)]"
          >
            {isLoading ? <StopIcon /> : <ArrowUpIcon />}
          </motion.button>
        </PromptInputAction>
      </PromptInput>
    </div>
  );
}
