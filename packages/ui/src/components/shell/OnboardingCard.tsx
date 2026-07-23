import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import {
  HiArrowTopRightOnSquare,
  HiCheck,
  HiOutlineClipboard,
} from 'react-icons/hi2';
import { SPRING_UI } from '../../lib/motion';
import type { ProviderAuth } from '../../lib/shell';
import { BowtieMark } from './BowtieMark';
import { ChatGptLogo, ClaudeLogo, GrokLogo } from './provider-logos';

/**
 * First-run onboarding: replaces the prompt bar until an AI is connected —
 * there is no skipping; connecting one is the way in. One continuous morph
 * instead of discrete pages: the chosen "Sign in with …" pill IS the primary
 * control the whole way — it stretches into "Getting your code…", then
 * "Open sign-in page", then "Start using Web Butler", while the provider
 * mark slides out of the pill into the heading. Motion layoutIds carry both
 * through every phase. A Back control on the connect step returns to the
 * provider choice for second thoughts.
 */

type Phase = 'welcome' | 'connect' | 'permissions' | 'done';

export type OnboardingProvider = 'codex' | 'grok' | 'claude';

const PROVIDER_ORDER = ['codex', 'grok', 'claude'] as const;

const PROVIDERS: Record<
  OnboardingProvider,
  {
    name: string;
    Logo: typeof ChatGptLogo;
    /** Instruction line while the sign-in is live. */
    pendingCopy: string;
    /**
     * Brand color for the pill, following it through every morph. Overrides
     * the accent classes (inline style wins) — undefined keeps the default.
     */
    tint?: { background: string; color: string };
  }
> = {
  codex: {
    name: 'ChatGPT',
    Logo: ChatGptLogo,
    pendingCopy: 'Log in with your ChatGPT account and enter this code:',
  },
  grok: {
    name: 'Grok',
    Logo: GrokLogo,
    pendingCopy: 'Sign in with your X account and confirm this code:',
  },
  // Claude runs the flow in reverse: the user gets a code from Anthropic
  // and pastes it back here instead of reading one off this card.
  claude: {
    name: 'Claude',
    Logo: ClaudeLogo,
    pendingCopy:
      'Sign in with your Anthropic account, then paste the code you’re given:',
    // Claude is orange — its official terracotta, white text on top.
    tint: { background: '#D97757', color: '#FFFFFF' },
  },
};

type OnboardingCardProps = {
  /** Codex device-auth state, owned by the shell (same as ProvidersView). */
  codex: ProviderAuth;
  /** Grok device-auth state — the welcome step offers every provider. */
  grok?: ProviderAuth;
  /** Claude auth state — reverse flow (the user pastes a code back). */
  claude?: ProviderAuth;
  /** Sign in / Try again — the shell starts that provider's device flow. */
  onConnect: (provider: OnboardingProvider) => void;
  /** Claude only: forward the code the user pasted back. */
  onSubmitCode?: (code: string) => void;
  /** A provider finished connecting — the shell makes it the active one. */
  onConnected?: (provider: OnboardingProvider) => void;
  /**
   * Gate only: "Not now" dismisses the card back to the prompt. Full
   * onboarding has no skip — connecting a provider is the only way through.
   */
  onSkip?: () => void;
  /** Finished (connected + acknowledged) — swap back to the prompt. */
  onDone: () => void;
  /**
   * gate: popped over the prompt when an unauthenticated message was
   * rejected — skips the welcome pitch and lands straight on connect.
   */
  variant?: 'onboarding' | 'gate';
  /**
   * Does this URL point at the page this tab is on? When the verification
   * page matches (the extension runs there too), "Open sign-in page" parks
   * as an inert "you're here" marker instead of opening it again.
   */
  isThisPage?: (url: string) => boolean;
  /**
   * Chrome's "Allow User Scripts" toggle, live (the shell polls it). Site
   * extensions can't inject without it, so full onboarding holds on a
   * permissions step until it flips — the step advances by itself when the
   * user enables it. The gate variant never requires it (chat works fine).
   */
  userScriptsEnabled?: boolean;
  /** Open chrome://extensions on this extension so the toggle is right there. */
  onOpenUserScriptsSettings?: () => void;
};

/** "12:04" until the target, ticking each second; null when no target. */
function useCountdown(target?: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target) return null;
  const left = Math.max(0, target - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Cycles "", ".", "..", "..." — same cadence as the prompt's Working hint. */
function useWaitingDots(active: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const id = window.setInterval(
      () => setCount((current) => (current + 1) % 4),
      420,
    );
    return () => window.clearInterval(id);
  }, [active]);
  return '.'.repeat(count);
}

// Hover: an inset white wash — reads as a slight background lightening on
// any pill color (opacity/brightness do nothing on near-black backgrounds).
const PILL =
  'webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-4 webbutler:py-1.5 webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]';

/** The pill's inert form — visibly not a control (no accent, no cursor). */
const PILL_INERT =
  'webbutler:flex webbutler:cursor-default webbutler:select-none webbutler:items-center webbutler:gap-2 webbutler:rounded-full webbutler:bg-[var(--wc-hover-2)] webbutler:px-4 webbutler:py-1.5 webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-text-3)]';

const GHOST_BUTTON =
  'webbutler:cursor-pointer webbutler:rounded-full webbutler:px-3 webbutler:py-1.5 webbutler:text-[12px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]';

/** Fade-up for phase copy; the pill + logo morph instead of fading. */
const fade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: SPRING_UI,
};

export function OnboardingCard({
  codex,
  grok = { status: 'unknown' },
  claude = { status: 'unknown' },
  onConnect,
  onSubmitCode,
  onConnected,
  onSkip,
  onDone,
  variant = 'onboarding',
  isThisPage,
  userScriptsEnabled,
  onOpenUserScriptsSettings,
}: OnboardingCardProps) {
  const gate = variant === 'gate';
  const [phase, setPhase] = useState<Phase>(gate ? 'connect' : 'welcome');
  // Which provider the connect/done phases are about. The welcome step
  // offers all; the gate defaults to ChatGPT (the shell pre-starts it).
  const [provider, setProvider] = useState<OnboardingProvider>('codex');
  const [copied, setCopied] = useState(false);
  // Claude's reverse flow: what the user pasted, and whether it's in flight.
  const [codeInput, setCodeInput] = useState('');
  const [codeSubmitted, setCodeSubmitted] = useState(false);
  // The user has steered the card themselves (picked a provider or pressed
  // Back). From then on the auto re-aim below stays out of the way: it
  // exists to catch a login already in flight when the card first shows,
  // and after an explicit choice it would only fight the user — e.g.
  // bouncing them back into a pending flow they just backed out of.
  const [userNavigated, setUserNavigated] = useState(false);

  // layoutIds must be unique per instance (Storybook renders several) and
  // per provider, so the clicked pill is the one that morphs onward.
  const uid = useId();
  const pillId = (p: OnboardingProvider) => `${uid}-pill-${p}`;
  const logoId = (p: OnboardingProvider) => `${uid}-logo-${p}`;

  const auths: Record<OnboardingProvider, ProviderAuth> = {
    codex,
    grok,
    claude,
  };
  const auth = auths[provider];
  const { name, Logo, pendingCopy, tint } = PROVIDERS[provider];

  const gettingDots = useWaitingDots(auth.status === 'starting');
  const verifyingDots = useWaitingDots(codeSubmitted);
  const toggleDots = useWaitingDots(phase === 'permissions');
  const codeTimeLeft = useCountdown(
    auth.status === 'pending' ? auth.expiresAt : undefined,
  );

  // This tab IS the verification page — don't offer to open it again.
  const onSignInPage =
    auth.status === 'pending' &&
    auth.verificationUrl != null &&
    (isThisPage?.(auth.verificationUrl) ?? false);

  // The CLI on the VM notices the sign-in on its own; the moment the
  // shell's polling reports connected, morph onward without asking, and
  // let the shell adopt the fresh provider as the active one. Full
  // onboarding holds on the permissions step when Chrome's user-scripts
  // toggle is off — site extensions can't work without it. The gate skips
  // that (it exists to unblock a message, not to set everything up).
  useEffect(() => {
    if (phase === 'connect' && auth.status === 'connected') {
      setPhase(!gate && userScriptsEnabled === false ? 'permissions' : 'done');
      onConnected?.(provider);
    }
  }, [phase, auth.status, provider, onConnected, gate, userScriptsEnabled]);

  // The permissions step watches the live toggle and advances by itself —
  // flipping it in chrome://extensions is the whole interaction.
  useEffect(() => {
    if (phase === 'permissions' && userScriptsEnabled) setPhase('done');
  }, [phase, userScriptsEnabled]);

  // Claude rejected the pasted code (still pending, but with an error) —
  // stop "Verifying…" and hand the input back for another try.
  useEffect(() => {
    if (codeSubmitted && auth.status === 'pending' && auth.error) {
      setCodeSubmitted(false);
      setCodeInput('');
    }
  }, [codeSubmitted, auth.status, auth.error]);

  // A login already in flight (started from another tab — e.g. this IS the
  // sign-in page) takes over: the welcome pitch skips straight to connect,
  // and a gate that defaulted to ChatGPT re-aims at the live provider. Only
  // until the user steers the card themselves — after that, never hijack.
  useEffect(() => {
    if (phase === 'done' || phase === 'permissions' || userNavigated) return;
    const busy = (status: ProviderAuth['status']) =>
      status === 'starting' || status === 'pending';
    // In connect, only re-aim while the chosen provider sits idle — never
    // hijack an explicit choice or a finished connection.
    if (phase === 'connect') {
      const current = auths[provider].status;
      if (busy(current) || current === 'connected') return;
    }
    const inFlight = PROVIDER_ORDER.find((p) => busy(auths[p].status));
    if (inFlight) {
      setProvider(inFlight);
      setPhase('connect');
    }
  });

  const signIn = (p: OnboardingProvider) => {
    setUserNavigated(true);
    setProvider(p);
    setPhase('connect');
    setCodeInput('');
    setCodeSubmitted(false);
    onConnect(p);
  };

  // Second thoughts: back to the provider choice. The abandoned flow keeps
  // running on the VM — re-picking the same provider just restarts it.
  const goBack = () => {
    setUserNavigated(true);
    setPhase('welcome');
    setCodeInput('');
    setCodeSubmitted(false);
  };

  const submitCode = () => {
    const code = codeInput.trim();
    if (!code || codeSubmitted) return;
    setCodeSubmitted(true);
    onSubmitCode?.(code);
  };

  const copyCode = () => {
    if (!auth.userCode) return;
    void navigator.clipboard?.writeText(auth.userCode).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  // The connect step's ghost control: the gate can be waved away ("Not
  // now"), but onboarding only goes backward — to the provider choice.
  const ghostAction = gate ? (
    <button type="button" onClick={onSkip} className={GHOST_BUTTON}>
      Not now
    </button>
  ) : (
    <button type="button" onClick={goBack} className={GHOST_BUTTON}>
      Back
    </button>
  );

  return (
    <motion.div
      layout
      transition={SPRING_UI}
      className="webbutler:w-full webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:px-5 webbutler:py-4 webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150"
    >
      {phase === 'welcome' ? (
        // Two columns: the pitch on the left, the four actions stacked on
        // the right. Top-aligned so the heading sits at the top of the card.
        <div className="webbutler:flex webbutler:items-start webbutler:gap-5">
          <div className="webbutler:min-w-0 webbutler:flex-1">
            <motion.div {...fade} className="webbutler:flex webbutler:items-center webbutler:gap-2.5">
              <motion.span whileHover="adjust" initial="rest" animate="rest">
                <BowtieMark size={26} knot="var(--wc-selection)" />
              </motion.span>
              <h2 className="webbutler:text-[14px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
                Welcome to Web Butler
              </h2>
            </motion.div>
            <motion.p
              {...fade}
              className="webbutler:pt-1.5 webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]"
            >
              Your butler for the web
            </motion.p>
            <motion.ul {...fade} className="webbutler:flex webbutler:flex-col webbutler:gap-1 webbutler:pt-2.5">
              {[
                'Uses your existing subscriptions',
                'Modify Websites',
                'Complete Tasks',
                'Generate Reports',
              ].map((point) => (
                <li
                  key={point}
                  className="webbutler:flex webbutler:items-center webbutler:gap-2 webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]"
                >
                  <span
                    aria-hidden
                    className="webbutler:size-1 webbutler:shrink-0 webbutler:rounded-full webbutler:bg-[var(--wc-text-4)]"
                  />
                  {point}
                </li>
              ))}
            </motion.ul>
          </div>
          <div className="webbutler:flex webbutler:w-[188px] webbutler:shrink-0 webbutler:flex-col webbutler:gap-1.5">
            {PROVIDER_ORDER.map((p) => {
              const ProviderLogo = PROVIDERS[p].Logo;
              return (
                <motion.button
                  key={p}
                  layoutId={pillId(p)}
                  transition={SPRING_UI}
                  type="button"
                  autoFocus={p === 'codex'}
                  onClick={() => signIn(p)}
                  style={PROVIDERS[p].tint}
                  // Left-anchored so the three marks line up down the stack.
                  className={PILL}
                >
                  <motion.span
                    layoutId={logoId(p)}
                    transition={SPRING_UI}
                    className="webbutler:flex"
                  >
                    <ProviderLogo size={14} />
                  </motion.span>
                  {/* layout="position": the label slides during the pill's
                      resize morph instead of stretching with it. */}
                  <motion.span layout="position">
                    Sign in with {PROVIDERS[p].name}
                  </motion.span>
                </motion.button>
              );
            })}
          </div>
        </div>
      ) : phase === 'connect' ? (
        <div>
          {auth.status === 'failed' || auth.status === 'expired' ? (
            <>
              {/* The provider mark slides up here, out of the pill. */}
              <div className="webbutler:flex webbutler:items-center webbutler:gap-2">
                <motion.span
                  layoutId={logoId(provider)}
                  transition={SPRING_UI}
                  className="webbutler:flex webbutler:text-[var(--wc-ink)]"
                >
                  <Logo size={15} />
                </motion.span>
                <motion.h2
                  {...fade}
                  className="webbutler:text-[13px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
                >
                  Connect {name}
                </motion.h2>
              </div>
              <motion.p
                {...fade}
                className="webbutler:pt-1.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-3)]"
              >
                {auth.status === 'expired'
                  ? 'That code expired before the sign-in finished.'
                  : (auth.error ?? 'Something went wrong starting the sign-in.')}
              </motion.p>
              <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:pt-3.5">
                <motion.button
                  layoutId={pillId(provider)}
                  transition={SPRING_UI}
                  type="button"
                  onClick={() => onConnect(provider)}
                  style={tint}
                  className={PILL}
                >
                  <motion.span layout="position">Try again</motion.span>
                </motion.button>
                {ghostAction}
              </div>
            </>
          ) : (
            <>
              {/* Two columns: heading + instructions left, code right —
                  the chip sits on the same lines instead of its own row. */}
              <div className="webbutler:flex webbutler:items-center webbutler:justify-between webbutler:gap-4">
                <div className="webbutler:min-w-0">
                  {/* The provider mark slides up here, out of the pill. */}
                  <div className="webbutler:flex webbutler:items-center webbutler:gap-2">
                    <motion.span
                      layoutId={logoId(provider)}
                      transition={SPRING_UI}
                      className="webbutler:flex webbutler:text-[var(--wc-ink)]"
                    >
                      <Logo size={15} />
                    </motion.span>
                    <motion.h2
                      {...fade}
                      className="webbutler:text-[13px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
                    >
                      Connect {name}
                    </motion.h2>
                  </div>
                  <motion.p
                    {...fade}
                    className="webbutler:pt-1.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-3)]"
                  >
                    {auth.status === 'pending'
                      ? (auth.error ?? pendingCopy)
                      : gate
                        ? `Web Butler needs your ${name} account before it can work on messages. You’ll get a short code to enter after signing in.`
                        : 'You’ll get a short code to enter after signing in. It takes about a minute.'}
                  </motion.p>
                </div>

                {/* Claude's reverse flow: the code comes FROM the user. */}
                <AnimatePresence>
                  {provider === 'claude' && auth.status === 'pending' ? (
                    <motion.div
                      key="code-input"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={SPRING_UI}
                      className="webbutler:shrink-0"
                    >
                      {codeSubmitted ? (
                        <span className="webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]">
                          Verifying
                          <span className="webbutler:inline-block webbutler:w-[13px] webbutler:text-left">
                            {verifyingDots}
                          </span>
                        </span>
                      ) : (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            submitCode();
                          }}
                          className="webbutler:flex webbutler:items-center webbutler:gap-1.5"
                        >
                          <input
                            value={codeInput}
                            onChange={(event) => setCodeInput(event.target.value)}
                            placeholder="Paste your code"
                            autoComplete="off"
                            spellCheck={false}
                            className="webbutler:w-[168px] webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border-strong)] webbutler:bg-transparent webbutler:px-3 webbutler:py-1.5 webbutler:font-mono webbutler:text-[12px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:placeholder:text-[var(--wc-text-4)] webbutler:focus:border-[var(--wc-ink)]"
                          />
                          <button
                            type="submit"
                            disabled={!codeInput.trim()}
                            style={tint}
                            className={`${PILL} webbutler:disabled:cursor-default webbutler:disabled:opacity-40`}
                          >
                            Connect
                          </button>
                        </form>
                      )}
                    </motion.div>
                  ) : auth.status === 'pending' && auth.userCode ? (
                    <motion.div
                      key="code"
                      initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={SPRING_UI}
                      className="webbutler:shrink-0"
                    >
                      {/* The whole chip is the copy button — the clipboard icon
                          lives inside the border and the border answers hover. */}
                      <button
                        type="button"
                        onClick={copyCode}
                        aria-label="Copy code"
                        className="webbutler:group webbutler:flex webbutler:cursor-pointer webbutler:items-center webbutler:gap-3 webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border-strong)] webbutler:bg-transparent webbutler:px-4 webbutler:py-1.5 webbutler:font-mono webbutler:text-[18px] webbutler:font-medium webbutler:tracking-[0.14em] webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-ink)] webbutler:hover:bg-[var(--wc-hover-2)]"
                      >
                        {auth.userCode}
                        <span
                          aria-hidden
                          className="webbutler:flex webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:group-hover:text-[var(--wc-ink)]"
                        >
                          {copied ? (
                            <HiCheck size={14} />
                          ) : (
                            <HiOutlineClipboard size={14} />
                          )}
                        </span>
                      </button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <div className="webbutler:flex webbutler:items-center webbutler:justify-between webbutler:pt-3.5">
                <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5">
                  {auth.status === 'pending' && onSignInPage ? (
                    // Already here — opening the page again would be jank, so
                    // the pill parks as an inert gray "you're in the right
                    // place" marker.
                    <motion.div
                      layoutId={pillId(provider)}
                      transition={SPRING_UI}
                      className={PILL_INERT}
                    >
                      <motion.span layout="position">
                        You’re on the sign-in page
                      </motion.span>
                    </motion.div>
                  ) : auth.status === 'pending' && auth.verificationUrl ? (
                    <motion.a
                      layoutId={pillId(provider)}
                      transition={SPRING_UI}
                      href={auth.verificationUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={tint}
                      className={`${PILL} webbutler:no-underline`}
                    >
                      <motion.span layout="position">Open sign-in page</motion.span>
                      <motion.span layout="position" className="webbutler:flex">
                        <HiArrowTopRightOnSquare size={11} aria-hidden />
                      </motion.span>
                    </motion.a>
                  ) : (
                    // starting: the sign-in pill, mid-morph, holding for the code.
                    <motion.div
                      layoutId={pillId(provider)}
                      transition={SPRING_UI}
                      style={tint}
                      className={`${PILL} webbutler:cursor-default webbutler:opacity-75 webbutler:hover:shadow-none`}
                    >
                      <motion.span layout="position">
                        Getting your code
                        {/* Reserved width: cycling dots must not resize the pill. */}
                        <span className="webbutler:inline-block webbutler:w-[13px] webbutler:text-left">
                          {gettingDots}
                        </span>
                      </motion.span>
                    </motion.div>
                  )}
                  {ghostAction}
                </div>
                {auth.status === 'pending' && codeTimeLeft ? (
                  <motion.span
                    {...fade}
                    className="webbutler:text-[11px] webbutler:tabular-nums webbutler:text-[var(--wc-text-4)]"
                  >
                    code expires in {codeTimeLeft}
                  </motion.span>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : phase === 'permissions' ? (
        <div>
          <div className="webbutler:flex webbutler:items-center webbutler:gap-2">
            <motion.span
              layoutId={logoId(provider)}
              transition={SPRING_UI}
              className="webbutler:flex webbutler:text-[var(--wc-ink)]"
            >
              <Logo size={15} />
            </motion.span>
            <motion.h2
              {...fade}
              className="webbutler:text-[13px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
            >
              One last thing: allow user scripts
            </motion.h2>
          </div>
          <motion.p
            {...fade}
            className="webbutler:pt-1.5 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-3)]"
          >
            {name} is connected. To modify websites for you, Chrome needs its
            "Allow User Scripts" switch turned on for Web Butler. Open the
            settings, flip the switch, and this step finishes on its own. (On
            older Chrome the switch is called Developer mode.)
          </motion.p>
          <div className="webbutler:flex webbutler:items-center webbutler:justify-between webbutler:pt-3.5">
            <motion.button
              layoutId={pillId(provider)}
              transition={SPRING_UI}
              type="button"
              autoFocus
              onClick={onOpenUserScriptsSettings}
              style={tint}
              className={PILL}
            >
              <motion.span layout="position">Open extension settings</motion.span>
              <motion.span layout="position" className="webbutler:flex">
                <HiArrowTopRightOnSquare size={11} aria-hidden />
              </motion.span>
            </motion.button>
            <motion.span
              {...fade}
              className="webbutler:text-[11px] webbutler:text-[var(--wc-text-4)]"
            >
              waiting for the switch
              <span className="webbutler:inline-block webbutler:w-[13px] webbutler:text-left">
                {toggleDots}
              </span>
            </motion.span>
          </div>
        </div>
      ) : (
        <div>
          <div className="webbutler:flex webbutler:items-center webbutler:gap-2">
            <motion.span
              layoutId={logoId(provider)}
              transition={SPRING_UI}
              className="webbutler:flex webbutler:text-[var(--wc-ink)]"
            >
              <Logo size={15} />
            </motion.span>
            <motion.h2
              {...fade}
              className="webbutler:text-[14px] webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
            >
              You’re all set
            </motion.h2>
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING_UI}
              className="webbutler:flex webbutler:size-4 webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:bg-[var(--wc-selection)] webbutler:text-white"
            >
              <HiCheck size={10} aria-hidden />
            </motion.span>
          </div>
          <motion.p
            {...fade}
            className="webbutler:pt-2 webbutler:text-[12px] webbutler:leading-relaxed webbutler:text-[var(--wc-text-3)]"
          >
            {gate
              ? `${name} is connected. Your message is still in the box, send it whenever you’re ready.`
              : `${name} is connected. Ask about the page you’re on, or hand off something bigger like research, drafts, and reports. Web Butler works on it in the background.`}
          </motion.p>
          <div className="webbutler:pt-3.5">
            <motion.button
              layoutId={pillId(provider)}
              transition={SPRING_UI}
              type="button"
              autoFocus
              onClick={onDone}
              style={tint}
              className={PILL}
            >
              <motion.span layout="position">
                {gate ? 'Back to your message' : 'Start using Web Butler'}
              </motion.span>
            </motion.button>
          </div>
        </div>
      )}

    </motion.div>
  );
}
