import {
  AnswerCard,
  CollapsedPill,
  PlusButton,
  PromptPanel,
} from '@web-butler/ui';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

/**
 * The homepage demo: the REAL shell components from @web-butler/ui —
 * CollapsedPill, PromptPanel, PlusButton, AnswerCard — scripted through
 * one errand on a loop, over a skeleton feed. What ships is what's shown.
 *
 * The window frame and feed styling live in the page stylesheet
 * (public/style.css); the shell draws itself. The whole stage is `inert`:
 * theater, not a working input.
 */

const ERRAND = 'Always hide the sponsored posts here';

/** idle → open → typing → working → done → (hold) → idle … */
type Phase = 'idle' | 'open' | 'typing' | 'working' | 'done';

const noop = () => {};

export function Demo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const [enabled, setEnabled] = useState(true);
  const mountRef = useRef<HTMLDivElement | null>(null);

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
    return () => {
      disposed = true;
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  const working = phase === 'working';

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
      <div className="butler" aria-hidden="true" inert>
        <div
          id="web-butler-root"
          style={{ '--wc-selection': '#3b82f6', height: 'auto' } as CSSProperties}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {phase === 'done' ? (
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
            {phase === 'idle' ? (
              <CollapsedPill onOpen={noop} />
            ) : (
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
            )}
          </div>
        </div>
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
