import {
  AnswerCard,
  CollapsedPill,
  ContextChips,
  ElementHighlight,
  ElementPickerOverlay,
  PlusButton,
  PromptPanel,
  resolvePickedElement,
  type PickedElement,
} from '@web-butler/ui';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DetailedHTMLProps,
  type HTMLAttributes,
} from 'react';

/**
 * The homepage demo: the REAL shell components from @web-butler/ui —
 * CollapsedPill, PromptPanel, PlusButton, AnswerCard — scripted through
 * one errand on a loop, over a skeleton feed. What ships is what's shown.
 *
 * And the controls are live. The first real interaction (the pill, the
 * crosshair) stops the theater and hands the shell to the visitor: the
 * element picker genuinely works against this page, picked elements become
 * context chips with tracking highlights, and sending gets an honest answer
 * about where the demo ends.
 *
 * The window frame and feed styling live in the page stylesheet
 * (public/style.css); the shell draws itself.
 */

// The extension mounts the shell in a shadow root under a <web-butler> host;
// the picker overlay uses that tag to tell "our UI" from "the page". The demo
// mounts in the light DOM under the same tag so the same filter applies.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'web-butler': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

const ERRAND = 'Always hide the sponsored posts here';
const ACCENT = '#3b82f6';
const NO_MISSING: ReadonlySet<string> = new Set();

/** idle → open → typing → working → done → (hold) → idle … */
type Phase = 'idle' | 'open' | 'typing' | 'working' | 'done';

const noop = () => {};

/** What sending in the demo honestly gets you. */
function demoAnswer(prompt: string, pickedCount: number): string {
  const quoted = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
  const context =
    pickedCount > 0
      ? pickedCount === 1
        ? ', along with the element you picked,'
        : `, along with the ${pickedCount} elements you picked,`
      : '';
  return `The demo stops here: this page has no agent behind it. In the extension, "${quoted}"${context} would go straight to your own AI, and the result would land in this card.`;
}

export function Demo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Live mode: the visitor touched a real control, the theater stops, and
  // the components behave exactly like they do in the extension.
  const [live, setLive] = useState(false);
  const [draft, setDraft] = useState('');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement[]>([]);
  const [hoveredChip, setHoveredChip] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  const mountRef = useRef<HTMLDivElement | null>(null);
  // Lets the takeover handler kill the theater loop from outside its effect.
  const stopLoopRef = useRef<() => void>(noop);

  // The feed folds through the same CSS the static page used: a data-state
  // attribute on the .window element around this mount.
  useEffect(() => {
    const win = mountRef.current?.closest<HTMLElement>('.window');
    if (win) win.dataset.state = phase;
  }, [phase]);

  useEffect(() => {
    // ?phase=working freezes the theater on one phase — for screenshots
    // and visual review. Not linked anywhere.
    const forced = new URLSearchParams(window.location.search).get('phase');
    if (forced) {
      setPhase(forced as Phase);
      if (forced === 'typing') setTyped(ERRAND.slice(0, 21));
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No theater: rest on the delivered state.
      setPhase('done');
      return;
    }

    let timers: number[] = [];
    let disposed = false;
    const later = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const run = () => {
      if (disposed) return;
      timers.forEach(clearTimeout);
      timers = [];
      setTyped('');
      setEnabled(true);
      setPhase('idle');

      later(900, () => setPhase('open'));
      later(1700, () => {
        setPhase('typing');
        let i = 0;
        const type = () => {
          i += 1;
          setTyped(ERRAND.slice(0, i));
          if (i < ERRAND.length) {
            timers.push(window.setTimeout(type, 34 + Math.random() * 40));
          } else {
            later(500, () => {
              setTyped('');
              setPhase('working');
              later(4100, () => {
                setPhase('done');
                later(5600, run); // hold the delivered state, then again
              });
            });
          }
        };
        type();
      });
    };

    // Start when the demo scrolls into view; one loop from then on.
    const stage = mountRef.current?.closest('.window');
    if (!stage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(stage);
    const stop = () => {
      disposed = true;
      io.disconnect();
      timers.forEach(clearTimeout);
      timers = [];
    };
    stopLoopRef.current = stop;
    return stop;
  }, []);

  /** First real interaction: the theater yields, the visitor drives. */
  const takeControl = () => {
    if (live) return;
    stopLoopRef.current();
    setLive(true);
    setTyped('');
    setPhase('open');
  };

  const togglePicker = () => {
    takeControl();
    setPicking((was) => !was);
  };

  const handlePick = (element: PickedElement, keepPicking: boolean) => {
    setPicked((prev) =>
      prev.some((p) => p.selector === element.selector)
        ? prev
        : [...prev, element],
    );
    if (!keepPicking) setPicking(false);
  };

  const handleSubmit = (text: string) => {
    setAnswer(null);
    setSending(true);
    const count = picked.length;
    window.setTimeout(() => {
      setSending(false);
      setAnswer(demoAnswer(text, count));
    }, 1600);
  };

  const working = live ? sending : phase === 'working';
  const showPrompt = live || phase !== 'idle';

  return (
    <div ref={mountRef} style={{ display: 'contents' }}>
      <div className="feed" aria-hidden="true">
        <Post lines={['w-72', 'w-48']} />
        <Post lines={['w-64', 'w-56']} sponsored />
        <Post lines={['w-80', 'w-40']} />
        <Post lines={['w-56', 'w-64']} sponsored />
      </div>

      {/* The butler, docked like the real thing. Token root + accent, same
          as the content script's mount. */}
      <div className="butler">
        <web-butler style={{ display: 'block' }}>
          <div
            id="web-butler-root"
            style={{ '--wc-selection': ACCENT, height: 'auto' } as CSSProperties}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {!live && phase === 'done' ? (
                <AnswerCard
                  tier="extension"
                  text="Installed"
                  title="Hide sponsored posts"
                  description="Hides sponsored posts in this feed, on every visit."
                  urlPatterns={['https://your-feed.example/*']}
                  scriptingAllowed
                  extensionEnabled={enabled}
                  onExtensionToggle={setEnabled}
                />
              ) : null}
              {live && answer !== null ? (
                <AnswerCard
                  tier="answer"
                  text={answer}
                  onDismiss={() => setAnswer(null)}
                />
              ) : null}
              {live && picked.length > 0 ? (
                <div style={{ width: '100%' }}>
                  <ContextChips
                    elements={picked}
                    missingIds={NO_MISSING}
                    onRemove={(id) =>
                      setPicked((prev) => prev.filter((p) => p.id !== id))
                    }
                    onHover={(element) => setHoveredChip(element?.id ?? null)}
                    onJump={(element) => {
                      resolvePickedElement(element)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                    }}
                  />
                </div>
              ) : null}
              {showPrompt ? (
                <div style={{ width: '100%' }}>
                  <PromptPanel
                    leading={
                      <PlusButton
                        unread={0}
                        open={false}
                        onClick={noop}
                        working={working}
                      />
                    }
                    value={live ? draft : typed}
                    onValueChange={live ? setDraft : noop}
                    onSubmit={live ? handleSubmit : undefined}
                    loading={working}
                    pickerActive={picking}
                    onTogglePicker={togglePicker}
                  />
                </div>
              ) : (
                <CollapsedPill onOpen={takeControl} />
              )}
            </div>

            {/* The real pick layer, over this very page. Esc cancels,
                shift-click collects several — same as in the extension. */}
            {picking ? (
              <ElementPickerOverlay
                onPick={handlePick}
                onCancel={() => setPicking(false)}
              />
            ) : null}
            {picked.map((element) => (
              <ElementHighlight
                key={element.id}
                element={element}
                accentColor={ACCENT}
                emphasis={hoveredChip === element.id}
              />
            ))}
          </div>
        </web-butler>
      </div>
    </div>
  );
}

function Post({ lines, sponsored }: { lines: string[]; sponsored?: boolean }) {
  return (
    <article className={sponsored ? 'post sponsored' : 'post'}>
      <span className="avatar" />
      <span className="lines">
        {lines.map((width) => (
          <span key={width} className={`line ${width}`} />
        ))}
      </span>
      {sponsored ? <span className="tag">Sponsored</span> : null}
    </article>
  );
}
