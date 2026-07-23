import {
  AnswerCard,
  CollapsedPill,
  ContextChips,
  GhostCursor,
  INITIAL_GHOST_CURSOR,
  PlusButton,
  PromptPanel,
  ReportView,
  shellVariants,
  SPRING_SHEET,
  SPRING_UI,
  type GhostCursorState,
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
 * as theater through four scripted errands — answering a question, altering
 * a page for good, filing a report, and filling a form. One window, one
 * butler, four example pages cycling underneath it.
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
  id: 'ask' | 'edit' | 'form' | 'report';
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
    id: 'form',
    tab: 'Errands',
    addr: 'checkout.example',
    prompt: 'Fill this checkout form from my saved details',
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

/** The report itself, delivered into the demo's side panel. */
const REPORT_MD = `Three tiers on plans.example, read side by side.

|  | Basic | Pro | Team |
| --- | --- | --- | --- |
| Price | $0 | $12/mo | $29/seat |
| Projects | 3 | Unlimited | Unlimited |
| History | 7 days | 90 days | 1 year |
| SSO | · | · | Yes |

**The fine print**

- Pro renews at $24/mo after year one. The banner price is introductory.
- Team bills annually, three seats minimum.
- Export works on every tier, so switching later is cheap.

**The call:** start on Basic, move to Pro when you hit the project cap.`;

/**
 * idle (pill) → per-scene: typing → working → done → next scene …
 * The form scene becomes acting while the cursor fills each field. The
 * report scene keeps going: done → point (the butler's cursor rides
 * to the Open button and clicks) → panel (the side panel serves the
 * report) → next scene.
 */
type Phase = 'typing' | 'working' | 'acting' | 'done' | 'point' | 'panel';

export function Demo() {
  const [open, setOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState('');
  const [cursor, setCursor] = useState<GhostCursorState>(INITIAL_GHOST_CURSOR);
  const [formStep, setFormStep] = useState(0);

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
    setCursor(INITIAL_GHOST_CURSOR);
    setFormStep(0);
    if (staticRef.current) {
      // Frozen theaters rest on the delivered state; for the report that
      // includes the served side panel.
      const id = SCENARIOS[index].id;
      if (id === 'form') setFormStep(4);
      setPhase(id === 'report' ? 'panel' : 'done');
      return;
    }
    setPhase('typing');
    const prompt = SCENARIOS[index].prompt;
    const advance = () => startScene((index + 1) % SCENARIOS.length);
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
            if (SCENARIOS[index].id === 'report') {
              later(1000, () => pointAndServe(advance));
            } else if (SCENARIOS[index].id === 'form') {
              later(700, () => fillForm(advance));
            } else {
              later(5200, advance);
            }
          });
        });
      }
    };
    later(600, typeNext);
  };

  /**
   * The report scene's second act: the butler's own GhostCursor rides to
   * the artifact card's Open button, clicks it, and the side panel slides
   * in with the report. Coordinates are viewport pixels, exactly like the
   * real cursor gets from the debugger.
   */
  const pointAndServe = (advance: () => void) => {
    const win = mountRef.current?.closest<HTMLElement>('.window');
    const stage = win?.querySelector('.stage');
    const openBtn = win
      ? Array.from(win.querySelectorAll('button')).find((b) =>
          (b.textContent ?? '').trim().startsWith('Open'),
        )
      : undefined;
    if (!win || !stage || !openBtn) {
      // Nothing to point at (mid-resize, odd layout): skip the flourish.
      later(4200, advance);
      return;
    }
    setPhase('point');
    const target = openBtn.getBoundingClientRect();
    const from = stage.getBoundingClientRect();
    setCursor({
      x: from.left + from.width * 0.42,
      y: from.top + from.height * 0.55,
      visible: true,
      pressCount: 0,
    });
    later(140, () =>
      setCursor((c) => ({
        ...c,
        x: target.left + target.width / 2 - 3,
        y: target.top + target.height / 2 - 2,
        label: 'Open report',
      })),
    );
    later(780, () => setCursor((c) => ({ ...c, pressCount: 1, label: undefined })));
    later(1040, () => setPhase('panel'));
    later(1700, () => setCursor((c) => ({ ...c, visible: false })));
    later(7600, advance);
  };

  /**
   * A visible browser errand: move the real GhostCursor through the checkout,
   * click each field, fill it from saved details, then press Review order.
   */
  const fillForm = (advance: () => void) => {
    const win = mountRef.current?.closest<HTMLElement>('.window');
    const stage = win?.querySelector<HTMLElement>('.stage');
    if (!win || !stage) {
      later(4200, advance);
      return;
    }

    setPhase('acting');
    const from = stage.getBoundingClientRect();
    setCursor({
      x: from.left + from.width * 0.72,
      y: from.top + 44,
      visible: true,
      pressCount: 0,
    });

    const visit = (
      selector: string,
      label: string,
      at: number,
      completedStep: number,
    ) => {
      later(at, () => {
        const target = win.querySelector<HTMLElement>(selector);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        setCursor((current) => ({
          ...current,
          x: rect.left + Math.min(rect.width * 0.3, 76),
          y: rect.top + rect.height / 2,
          label,
        }));
      });
      later(at + 620, () => {
        setCursor((current) => ({
          ...current,
          pressCount: current.pressCount + 1,
          label: undefined,
        }));
        setFormStep(completedStep);
      });
    };

    visit('[data-demo-field="name"]', 'Full name', 180, 1);
    visit('[data-demo-field="email"]', 'Email', 1250, 2);
    visit('[data-demo-field="address"]', 'Delivery address', 2320, 3);
    visit('[data-demo-field="review"]', 'Review order', 3500, 4);
    later(4300, () => setPhase('done'));
    later(4750, () => setCursor((current) => ({ ...current, visible: false })));
    later(9000, advance);
  };

  useEffect(() => {
    // ?scene=ask|edit|form|report freezes that scene's delivered state — for
    // screenshots and visual review. Not linked anywhere.
    const forced = new URLSearchParams(window.location.search).get('scene');
    const forcedIndex = SCENARIOS.findIndex((s) => s.id === forced);
    if (forcedIndex >= 0) {
      staticRef.current = true;
      setOpen(true);
      setSceneIndex(forcedIndex);
      const id = SCENARIOS[forcedIndex].id;
      if (id === 'form') setFormStep(4);
      setPhase(id === 'report' ? 'panel' : 'done');
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
  // sponsored-post fold CSS, data-panel squeezes the page for the side
  // panel (the way real Chrome does), the address bar reads the scene.
  useEffect(() => {
    const win = mountRef.current?.closest<HTMLElement>('.window');
    if (!win) return;
    win.dataset.state = !open
      ? 'idle'
      : phase === 'done' && scene.id === 'edit'
        ? 'done'
        : 'open';
    win.dataset.panel =
      phase === 'panel' && scene.id === 'report' ? 'open' : 'closed';
    const addr = win.querySelector('.addr');
    if (addr) addr.textContent = scene.addr;
  }, [open, phase, scene]);

  const selectScene = (index: number) => {
    setOpen(true);
    startScene(index);
  };

  const working = phase === 'working' || phase === 'acting';
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
          ) : scene.id === 'form' ? (
            <FormStage step={formStep} />
          ) : (
            <PlansStage />
          )}
        </motion.div>
      </AnimatePresence>

      {/* The side panel, serving the report the cursor just ordered.
          Slides over the stage's right edge while the page squeezes,
          the way Chrome's real side panel does. */}
      <AnimatePresence>
        {phase === 'panel' && scene.id === 'report' ? (
          <motion.aside
            key="side-panel"
            className="side-panel"
            initial={{ x: '108%' }}
            animate={{ x: 0 }}
            exit={{ x: '108%' }}
            transition={SPRING_SHEET}
            aria-hidden="true"
            inert
          >
            <web-butler style={{ display: 'block', height: '100%' }}>
              <div
                id="web-butler-root"
                style={{ '--wc-selection': ACCENT, height: '100%' } as CSSProperties}
              >
                <ReportView
                  title="Plan comparison"
                  description="Prices, limits, and the fine print, side by side."
                  meta="Filed by Web Butler · plans.example"
                  text={REPORT_MD}
                />
              </div>
            </web-butler>
          </motion.aside>
        ) : null}
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
                      {phase === 'done' || phase === 'point' || phase === 'panel' ? (
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
                          ) : scene.id === 'form' ? (
                            <AnswerCard
                              tier="status"
                              text="Checkout filled. Ready for your review."
                              onDismiss={noop}
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

      {/* Portal the hand above the animated window. The window's rise-in
          transform creates a containing block for fixed descendants; body
          keeps the cursor's viewport coordinates honest, like the extension. */}
      {createPortal(
        <GhostCursor state={cursor} accentColor={ACCENT} />,
        document.body,
      )}

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

/** A checkout the cursor can visibly complete, field by field. */
function FormStage({ step }: { step: number }) {
  return (
    <div className="demo-form">
      <div className="form-heading">
        <span className="headline" />
        <span className="form-total">$48.00</span>
      </div>
      <div className="form-fields">
        <DemoField
          label="Full name"
          value={step >= 1 ? 'Avery Morgan' : ''}
          active={step === 1}
          field="name"
        />
        <DemoField
          label="Email"
          value={step >= 2 ? 'avery@example.com' : ''}
          active={step === 2}
          field="email"
        />
        <DemoField
          label="Delivery address"
          value={step >= 3 ? '1428 Market Street' : ''}
          active={step === 3}
          field="address"
        />
      </div>
      <button
        type="button"
        data-demo-field="review"
        className={step >= 4 ? 'review filled' : 'review'}
      >
        {step >= 4 ? 'Ready to review' : 'Review order'}
      </button>
    </div>
  );
}

function DemoField({
  label,
  value,
  active,
  field,
}: {
  label: string;
  value: string;
  active: boolean;
  field: string;
}) {
  return (
    <div
      data-demo-field={field}
      className={active ? 'demo-field active' : 'demo-field'}
    >
      <span className="field-label">{label}</span>
      <span className={value ? 'field-value filled' : 'field-value'}>
        {value || ' '}
      </span>
    </div>
  );
}
