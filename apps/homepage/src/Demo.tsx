import {
  AnswerCard,
  CollapsedPill,
  ContextChips,
  PlusButton,
  PromptPanel,
  shellVariants,
  SPRING_UI,
  type PickedElement,
} from '@web-butler/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DetailedHTMLProps,
  type HTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The homepage demo: the REAL shell components from @web-butler/ui, played
 * as theater through three scripted errands — answering a question about
 * the page, altering the page for good, and filing a report. One window,
 * one butler, three example pages cycling underneath it.
 *
 * The shell is genuine but non-interactive (the whole stage is inert);
 * the only controls are the scenario tabs under the window. The window
 * frame and the faux-page skeletons are styled by public/style.css.
 */

// Mirrors the extension's mount tag; kept for parity with the real thing.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'web-butler': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

const ACCENT = '#3b82f6';
const NO_MISSING: ReadonlySet<string> = new Set();
const noop = () => {};

/** The element "picked" in the answering scene, worn as a context chip. */
const ASK_CHIP: PickedElement = {
  id: 'ask-chip',
  selector: 'main section.policy > p:nth-of-type(2)',
  label: 'p.policy',
  tag: 'p',
  text: 'Cancellation and refunds',
  html: '',
};

type Scenario = {
  id: 'ask' | 'edit' | 'report';
  tab: string;
  addr: string;
  prompt: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'ask',
    tab: 'Answers',
    addr: 'help.example',
    prompt: 'Can I cancel without losing my files?',
  },
  {
    id: 'edit',
    tab: 'Alterations',
    addr: 'your-feed.example',
    prompt: 'Always hide the sponsored posts here',
  },
  {
    id: 'report',
    tab: 'Reports',
    addr: 'plans.example',
    prompt: 'Compare these plans into a report',
  },
];

const ASK_ANSWER =
  'Yes. The policy you pointed at keeps exports available for 30 days ' +
  'after you cancel. Download your archive first: Settings, then Data, ' +
  'then Export.';

/** idle (pill) → per-scene: typing → working → done → next scene … */
type Phase = 'typing' | 'working' | 'done';

export function Demo() {
  const [open, setOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState('');

  const mountRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  // Frozen theaters (?scene= param, reduced motion) rest on the done state
  // and only move when a tab is pressed.
  const staticRef = useRef(false);

  const later = (ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const startScene = (index: number) => {
    clearTimers();
    setSceneIndex(index);
    setTyped('');
    if (staticRef.current) {
      setPhase('done');
      return;
    }
    setPhase('typing');
    const prompt = SCENARIOS[index].prompt;
    let i = 0;
    const typeNext = () => {
      i += 1;
      setTyped(prompt.slice(0, i));
      if (i < prompt.length) {
        later(34 + Math.random() * 40, typeNext);
      } else {
        later(550, () => {
          setTyped('');
          setPhase('working');
          later(3200, () => {
            setPhase('done');
            later(5200, () => startScene((index + 1) % SCENARIOS.length));
          });
        });
      }
    };
    later(600, typeNext);
  };

  useEffect(() => {
    // ?scene=ask|edit|report freezes that scene's delivered state — for
    // screenshots and visual review. Not linked anywhere.
    const forced = new URLSearchParams(window.location.search).get('scene');
    const forcedIndex = SCENARIOS.findIndex((s) => s.id === forced);
    if (forcedIndex >= 0) {
      staticRef.current = true;
      setOpen(true);
      setSceneIndex(forcedIndex);
      setPhase('done');
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No theater: rest on the first delivered state; tabs still switch.
      staticRef.current = true;
      setOpen(true);
      setPhase('done');
      return;
    }

    // Start when the demo scrolls into view; loop from then on.
    const stage = mountRef.current?.closest('.window');
    if (!stage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          later(900, () => setOpen(true));
          later(1700, () => startScene(0));
        }
      },
      { threshold: 0.35 },
    );
    io.observe(stage);
    return () => {
      io.disconnect();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scene = SCENARIOS[sceneIndex];

  // The window frame reacts through plain DOM: data-state drives the
  // sponsored-post fold CSS, the address bar reads the scene's site.
  useEffect(() => {
    const win = mountRef.current?.closest<HTMLElement>('.window');
    if (!win) return;
    win.dataset.state = !open
      ? 'idle'
      : phase === 'done' && scene.id === 'edit'
        ? 'done'
        : 'open';
    const addr = win.querySelector('.addr');
    if (addr) addr.textContent = scene.addr;
  }, [open, phase, scene]);

  const selectScene = (index: number) => {
    setOpen(true);
    startScene(index);
  };

  const working = phase === 'working';
  const tabsHost = document.getElementById('demo-tabs');

  return (
    <div ref={mountRef} style={{ display: 'contents' }}>
      {/* The faux page under the butler, one skeleton per scene. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={scene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          aria-hidden="true"
        >
          {scene.id === 'ask' ? (
            <ArticleStage />
          ) : scene.id === 'edit' ? (
            <FeedStage />
          ) : (
            <PlansStage />
          )}
        </motion.div>
      </AnimatePresence>

      {/* The butler, docked like the real thing — and inert: real
          components, scripted hands. */}
      <div className="butler" aria-hidden="true" inert>
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
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {open ? (
                  <motion.div
                    key="open"
                    variants={shellVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    style={{
                      transformOrigin: 'bottom center',
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {/* Results rise into the dock with the extension's
                        answer-slot spring. */}
                    <AnimatePresence initial={false}>
                      {phase === 'done' ? (
                        <motion.div
                          key={`${scene.id}-result`}
                          initial={{ opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={SPRING_UI}
                          style={{ width: '100%' }}
                        >
                          {scene.id === 'ask' ? (
                            <AnswerCard
                              tier="answer"
                              text={ASK_ANSWER}
                              onDismiss={noop}
                            />
                          ) : scene.id === 'edit' ? (
                            <AnswerCard
                              tier="extension"
                              text="Installed"
                              title="Hide sponsored posts"
                              description="Hides sponsored posts in this feed, on every visit."
                              urlPatterns={['https://your-feed.example/*']}
                              scriptingAllowed
                              extensionEnabled
                              onExtensionToggle={noop}
                            />
                          ) : (
                            <AnswerCard
                              tier="artifact"
                              text="Plan comparison"
                              title="Plan comparison"
                              description="Prices, limits, and the fine print, side by side."
                              onOpenReport={noop}
                              onDismiss={noop}
                            />
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>

                    {/* The answering scene points at the page: a picked
                        element, worn as a chip. */}
                    {scene.id === 'ask' ? (
                      <div style={{ width: '100%' }}>
                        <ContextChips
                          elements={[ASK_CHIP]}
                          missingIds={NO_MISSING}
                          onRemove={noop}
                          onHover={noop}
                          onJump={noop}
                        />
                      </div>
                    ) : null}

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
                        value={typed}
                        onValueChange={noop}
                        loading={working}
                      />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="collapsed"
                    variants={shellVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    style={{ transformOrigin: 'bottom center' }}
                  >
                    <CollapsedPill onOpen={noop} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </web-butler>
      </div>

      {/* Scenario tabs live outside the window frame. */}
      {tabsHost
        ? createPortal(
            <div
              className="demo-tabs"
              role="tablist"
              aria-label="Demo scenarios"
            >
              {SCENARIOS.map((s, index) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={index === sceneIndex}
                  className={index === sceneIndex ? 'on' : ''}
                  onClick={() => selectScene(index)}
                >
                  {s.tab}
                </button>
              ))}
            </div>,
            tabsHost,
          )
        : null}
    </div>
  );
}

/* ----------------------------------------------------------------------
   The example pages — abstract skeletons, one per errand.
---------------------------------------------------------------------- */

function FeedStage() {
  return (
    <div className="feed">
      <Post lines={['w-72', 'w-48']} />
      <Post lines={['w-64', 'w-56']} sponsored />
      <Post lines={['w-80', 'w-40']} />
      <Post lines={['w-56', 'w-64']} sponsored />
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

/** A help-center article; one paragraph carries the pick ring. */
function ArticleStage() {
  return (
    <div className="article">
      <span className="headline" />
      <span className="line w-40" />
      <span className="line w-80" />
      <span className="line w-72" />
      <span className="line w-64" />
      <div className="picked">
        <span className="picked-label">p.policy</span>
        <span className="line w-80" />
        <span className="line w-72" />
        <span className="line w-48" />
      </div>
      <span className="line w-72" />
      <span className="line w-56" />
    </div>
  );
}

/** A pricing page: three plans, ripe for a side-by-side report. */
function PlansStage() {
  return (
    <div className="plans">
      {(['w-48', 'w-56', 'w-40'] as const).map((width, index) => (
        <div key={width} className={index === 1 ? 'plan featured' : 'plan'}>
          <span className={`line ${width}`} />
          <span className="price" />
          <span className="line w-80" />
          <span className="line w-72" />
          <span className="line w-64" />
          <span className="buy" />
        </div>
      ))}
    </div>
  );
}
