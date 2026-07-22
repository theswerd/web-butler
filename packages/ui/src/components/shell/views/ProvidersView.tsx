import { motion } from "motion/react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HiArrowTopRightOnSquare } from "react-icons/hi2";
import type { Settings } from "../../../lib/settings";
import type { ProviderAuth } from "../../../lib/shell";
import {
  ChatGptLogo,
  ClaudeLogo,
  FreestyleLogo,
  GrokLogo,
} from "../provider-logos";
import { ViewHeader } from "./ViewHeader";

const ROW_COUNT = 4;

type ProvidersViewProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Codex (ChatGPT) device-auth state, owned by the shell. */
  codex?: ProviderAuth;
  /** Connect/Retry on the ChatGPT row — the shell starts the device flow. */
  onCodexConnect?: () => void;
  /** Grok device-auth state, owned by the shell. */
  grok?: ProviderAuth;
  /** Connect/Retry on the Grok row — the shell starts the device flow. */
  onGrokConnect?: () => void;
  /** Claude auth state — reverse flow (the user pastes a code back). */
  claude?: ProviderAuth;
  /** Connect/Retry on the Claude row — the shell starts the flow. */
  onClaudeConnect?: () => void;
  /** The user pasted Anthropic's code into the Claude row. */
  onClaudeSubmitCode?: (code: string) => void;
  /** ArrowLeft on a row — focus returns to the sidebar. */
  onExitLeft?: () => void;
};

/**
 * Connected providers double as a radio group: exactly one is the ACTIVE
 * provider (settings.provider), marked with an accent dot that slides
 * between rows on switch. Space/Enter/Right on a row either starts the
 * provider's auth flow (not connected) or makes it active (connected).
 */
export function ProvidersView({
  settings,
  onChange,
  codex = { status: "unknown" },
  onCodexConnect,
  grok = { status: "unknown" },
  onGrokConnect,
  claude = { status: "unknown" },
  onClaudeConnect,
  onClaudeSubmitCode,
  onExitLeft,
}: ProvidersViewProps) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const claudeCodeRef = useRef<HTMLInputElement | null>(null);
  // Claude's reverse flow: the pasted code lives here until submitted.
  const [claudeCode, setClaudeCode] = useState("");
  // layoutId namespace — Storybook renders several instances at once.
  const uid = useId();

  const focusRow = (index: number) => {
    const next = ((index % ROW_COUNT) + ROW_COUNT) % ROW_COUNT;
    rowRefs.current[next]?.focus();
  };

  const rowKeyDown =
    (index: number, activate: () => void) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(index + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusRow(index - 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          onExitLeft?.();
          break;
        case "ArrowRight":
        case "Enter":
        case " ":
          event.preventDefault();
          activate();
          break;
        default:
          break;
      }
    };

  const row = (
    index: number,
    logo: ReactNode,
    name: string,
    activate: () => void,
    control: ReactNode,
    hint?: string,
  ) => (
    <div
      ref={(el) => {
        rowRefs.current[index] = el;
      }}
      tabIndex={-1}
      data-wc-row
      onKeyDown={rowKeyDown(index, activate)}
      className="webbutler:px-3 webbutler:py-1.5 webbutler:outline-none webbutler:transition-colors webbutler:duration-100 webbutler:focus:bg-[var(--wc-hover-1)]"
    >
      <div className="webbutler:flex webbutler:items-center webbutler:justify-between webbutler:gap-3">
        <span className="webbutler:flex webbutler:min-w-0 webbutler:items-center webbutler:gap-2">
          <span className="webbutler:flex webbutler:size-4 webbutler:shrink-0 webbutler:items-center webbutler:justify-center webbutler:text-[var(--wc-ink)]">
            {logo}
          </span>
          <span className="webbutler:truncate webbutler:text-[11px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
            {name}
          </span>
        </span>
        {control}
      </div>
      {hint ? (
        <p className="webbutler:pt-0.5 webbutler:pl-6 webbutler:text-[9px] webbutler:text-[var(--wc-text-4)]">
          {hint}
        </p>
      ) : null}
    </div>
  );

  const buttonClass =
    "webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:border-[var(--wc-border-strong)] webbutler:hover:bg-[var(--wc-hover-1)]";

  /**
   * The connected control is the radio: the active row wears the sliding
   * accent dot + "Active"; other connected rows read "Connected" and a
   * hollow dot, and clicking (or Space) switches the active provider.
   */
  const connectedControl = (id: Settings["provider"]) => {
    const isActive = settings.provider === id;
    return isActive ? (
      <span className="webbutler:flex webbutler:shrink-0 webbutler:items-center webbutler:gap-1.5 webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
        <motion.span
          layoutId={`${uid}-active-dot`}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          aria-hidden
          className="webbutler:size-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-selection)]"
        />
        Active
      </span>
    ) : (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onChange({ provider: id })}
        title="Make this the active provider"
        className="webbutler:group webbutler:flex webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:gap-1.5 webbutler:rounded-md webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]"
      >
        <span
          aria-hidden
          className="webbutler:size-1.5 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border-strong)] webbutler:transition-colors webbutler:duration-100 webbutler:group-hover:border-[var(--wc-ink)]"
        />
        Connected
      </button>
    );
  };

  // Device-auth rows share one shape: the row's control and hint track the
  // flow. While pending, the control IS the verification link — the code
  // stays visible until the flow finishes on its own. Once connected, the
  // control becomes the active-provider radio.
  const deviceAuthRow = (
    id: Settings["provider"],
    auth: ProviderAuth,
    onConnect: (() => void) | undefined,
    pendingHint: string,
  ) => {
    const activate = () => {
      if (auth.status === "connected") {
        onChange({ provider: id });
        return;
      }
      if (auth.status === "pending" && auth.verificationUrl) {
        window.open(auth.verificationUrl, "_blank", "noopener");
        return;
      }
      // 'unknown' is the status fetch still in flight — connecting now
      // could race a session that's already live.
      if (auth.status === "starting" || auth.status === "unknown") return;
      onConnect?.();
    };

    const control =
      auth.status === "unknown" ? (
        // Status fetch in flight — never dangle a "Connect" that may flip
        // to Connected a beat later.
        <span className="webbutler:flex webbutler:shrink-0 webbutler:animate-pulse webbutler:items-center webbutler:gap-1.5 webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
          <span
            aria-hidden
            className="webbutler:size-1.5 webbutler:rounded-full webbutler:bg-[var(--wc-text-4)]"
          />
          Checking…
        </span>
      ) : auth.status === "pending" && auth.userCode ? (
        <a
          href={auth.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={-1}
          className="webbutler:flex webbutler:shrink-0 webbutler:items-center webbutler:gap-1.5 webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-strong)] webbutler:px-2 webbutler:py-0.5 webbutler:font-mono webbutler:text-[10px] webbutler:font-medium webbutler:tracking-[0.08em] webbutler:text-[var(--wc-ink)] webbutler:no-underline webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
        >
          {auth.userCode}
          <HiArrowTopRightOnSquare size={10} aria-hidden />
        </a>
      ) : auth.status === "connected" ? (
        connectedControl(id)
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onClick={activate}
          className={buttonClass}
        >
          {auth.status === "starting"
            ? "Connecting…"
            : auth.status === "failed" || auth.status === "expired"
              ? "Retry"
              : "Connect"}
        </button>
      );

    const hint =
      auth.status === "pending"
        ? pendingHint
        : auth.status === "failed" || auth.status === "expired"
          ? (auth.error ?? "Connection failed. Try again.")
          : undefined;

    return { activate, control, hint };
  };

  const codexRow = deviceAuthRow(
    "codex",
    codex,
    onCodexConnect,
    "Sign in with ChatGPT and enter this code. It connects automatically.",
  );
  const grokRow = deviceAuthRow(
    "grok",
    grok,
    onGrokConnect,
    "Sign in with your X account and confirm this code. It connects automatically.",
  );

  // Claude reverses the flow: no code to show — the user brings one back
  // from Anthropic's page, so pending renders a paste box + page link.
  const claudeBase = deviceAuthRow("claude", claude, onClaudeConnect, "");
  const claudePending = claude.status === "pending";
  const claudeRow = {
    activate: claudePending
      ? () => claudeCodeRef.current?.focus()
      : claudeBase.activate,
    hint: claudePending
      ? (claude.error ??
        "Open the sign-in page, then paste the code Anthropic gives you.")
      : claudeBase.hint,
    control: claudePending ? (
      <span className="webbutler:flex webbutler:shrink-0 webbutler:items-center webbutler:gap-1.5">
        <a
          href={claude.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={-1}
          aria-label="Open the Claude sign-in page"
          className="webbutler:flex webbutler:size-5 webbutler:items-center webbutler:justify-center webbutler:rounded-md webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)]"
        >
          <HiArrowTopRightOnSquare size={11} aria-hidden />
        </a>
        <input
          ref={claudeCodeRef}
          value={claudeCode}
          placeholder="Paste code"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setClaudeCode(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && claudeCode.trim()) {
              onClaudeSubmitCode?.(claudeCode.trim());
              setClaudeCode("");
            }
          }}
          className="webbutler:w-[140px] webbutler:shrink-0 webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-strong)] webbutler:bg-transparent webbutler:px-1.5 webbutler:py-0.5 webbutler:font-mono webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:placeholder:text-[var(--wc-text-4)] webbutler:focus:border-[var(--wc-ink)]"
        />
      </span>
    ) : (
      claudeBase.control
    ),
  };

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
      <ViewHeader label="Providers" />
      <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:pb-1.5 webbutler:pt-0.5">
        {row(
          0,
          <ChatGptLogo />,
          "ChatGPT",
          codexRow.activate,
          codexRow.control,
          codexRow.hint,
        )}

        {row(
          1,
          <GrokLogo />,
          "Grok",
          grokRow.activate,
          grokRow.control,
          grokRow.hint,
        )}

        {row(
          2,
          <span className="webbutler:flex webbutler:text-[#D97757]">
            <ClaudeLogo />
          </span>,
          "Claude",
          claudeRow.activate,
          claudeRow.control,
          claudeRow.hint,
        )}

        <p className="webbutler:px-3 webbutler:pt-2.5 webbutler:pb-1 webbutler:text-[10px] webbutler:font-medium webbutler:tracking-wide webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
          Platform
        </p>

        {row(
          3,
          <FreestyleLogo />,
          "Freestyle",
          () => keyInputRef.current?.focus(),
          <input
            ref={keyInputRef}
            type="password"
            value={settings.freestyleApiKey}
            placeholder="API key"
            autoComplete="off"
            onChange={(event) =>
              onChange({ freestyleApiKey: event.target.value })
            }
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                // Leave the input, back onto the row for roving.
                event.preventDefault();
                rowRefs.current[3]?.focus();
              }
            }}
            className="webbutler:w-[140px] webbutler:shrink-0 webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-transparent webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:placeholder:text-[var(--wc-text-4)] webbutler:focus:border-[var(--wc-border-strong)]"
          />,
          "Provided by the platform. Leave empty to use the built-in key.",
        )}
      </div>
    </div>
  );
}
