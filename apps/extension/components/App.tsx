import { AnimatePresence, motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { browser } from 'wxt/browser';
import {
  ACCENT_OPTIONS,
  AnswerCard,
  COMMAND_COMBO,
  CollapsedPill,
  ContextChips,
  DEFAULT_SETTINGS,
  ElementHighlight,
  ElementPickerOverlay,
  GhostCursor,
  INITIAL_GHOST_CURSOR,
  MESSAGE,
  MenuPanel,
  OnboardingCard,
  PlusButton,
  PromptPanel,
  RepairToast,
  TaskStrip,
  TaskToast,
  type GhostCursorState,
  comboMatches,
  capturePageContext,
  hotkeyRecording,
  isExcluded,
  popoverVariants,
  resolvePickedElement,
  shellVariants,
  SPRING_SHEET,
  SPRING_UI,
  useIsDark,
  type PickedElement,
  type ProviderAuth,
  type ShellMode,
  type SiteExtension,
  type Task,
  type ShellPosition,
  type ViewId,
  type WebButlerMessage,
} from '@web-butler/ui';
import {
  useArtifacts,
  useExtensions,
  useRepairAsk,
  useRun,
  useTasks,
} from '../lib/agent-state';
import { useOnboarding, useUserScriptsEnabled } from '../lib/onboarding';
import { useProviderAuth } from '../lib/provider-auth';
import { useSettings } from '../lib/settings-store';
import { useShellPersist } from '../lib/shell-state';

/** Fixed-position classes for each of the six shell locations. */
const POSITION_CLASSES: Record<ShellPosition, string> = {
  'top-left': 'webbutler:top-5 webbutler:left-5',
  'top-center':
    'webbutler:top-5 webbutler:left-1/2 webbutler:-translate-x-1/2',
  'top-right': 'webbutler:top-5 webbutler:right-5',
  'bottom-left': 'webbutler:bottom-5 webbutler:left-5',
  'bottom-center':
    'webbutler:bottom-5 webbutler:left-1/2 webbutler:-translate-x-1/2',
  'bottom-right': 'webbutler:bottom-5 webbutler:right-5',
};

/** Open-shell width; pills, answers, and toasts all match the prompt box. */
const SHELL_WIDTH = 560;

/**
 * Each provider's sign-in flow hops across sibling domains (claude.com →
 * claude.ai login → platform.claude.com); the family is the unit that
 * matters for "am I on this provider's sign-in page?".
 */
const PROVIDER_FAMILIES: Record<'codex' | 'grok' | 'claude', string[]> = {
  codex: ['openai.com', 'chatgpt.com'],
  grok: ['x.ai'],
  claude: ['claude.com', 'claude.ai', 'anthropic.com'],
};

/** Which provider's sign-in family a hostname belongs to, if any. */
function providerForHostname(
  hostname: string,
): 'codex' | 'grok' | 'claude' | null {
  const base = hostname.split('.').slice(-2).join('.');
  for (const [provider, domains] of Object.entries(PROVIDER_FAMILIES)) {
    if (domains.includes(base)) return provider as 'codex' | 'grok' | 'claude';
  }
  return null;
}

/** e.g. 'bottom-right' → 'bottom right' — anchors scale animations. */
function originFor(position: ShellPosition): string {
  const [vertical, horizontal] = position.split('-');
  return `${vertical} ${horizontal === 'center' ? 'center' : horizontal}`;
}

export function App() {
  const [shell, patchShell] = useShellPersist();
  // Tab-scoped: this tab's run (answers land here and nowhere else).
  const { run, start: startRun, clear: clearRun } = useRun();
  // Global: the session-wide task list, mirrored into every tab.
  const {
    tasks,
    unseen,
    finished,
    clearFinished,
    markSeen,
    markTaskSeen,
    cancelTask,
    removeTask,
    clearTasks,
  } = useTasks();
  // Global: every artifact of the session, for the menu's Artifacts view.
  const { artifacts, removeArtifact, clearArtifacts } = useArtifacts();
  // Global: the user's site extensions, for the menu's Extensions view.
  const {
    state: extensionsState,
    toggle: toggleExtension,
    remove: removeExtension,
  } = useExtensions();
  // Tab-local: an extension's self-check just failed on THIS page — the
  // background asks this tab's shell to offer a repair.
  const { ask: repairAsk, clear: clearRepairAsk } = useRepairAsk();
  const [settings, updateSettings] = useSettings();
  const isDark = useIsDark(settings.theme);
  const accentColor =
    ACCENT_OPTIONS.find((accent) => accent.id === settings.accent)?.value ??
    ACCENT_OPTIONS[0].value;
  // True once the user explicitly opens (shortcut / pill click) — the prompt
  // then grabs focus. Never autofocus on plain page load / restore.
  const [focusOnOpen, setFocusOnOpen] = useState(false);

  // Element picker: page elements referenced as context for the next message.
  // Deliberately not persisted — selections are DOM-specific to this page.
  const [pickerActive, setPickerActive] = useState(false);
  const [picked, setPicked] = useState<PickedElement[]>([]);
  // A task referenced from the strip: the next message is a follow-up onto
  // it (same agent session) instead of a fresh task — the task-shaped
  // sibling of referencing a page element.
  const [replyTaskId, setReplyTaskId] = useState<string | null>(null);
  // The butler's ghost cursor while it drives this tab (browser control).
  // Driven entirely by BROWSER_CURSOR messages from the background.
  const [ghostCursor, setGhostCursor] =
    useState<GhostCursorState>(INITIAL_GHOST_CURSOR);
  // Chip currently hovered — its page element gets the glow treatment.
  const [hoveredChip, setHoveredChip] = useState<PickedElement | null>(null);
  // References whose selector no longer resolves (element deleted/replaced).
  const [missingIds, setMissingIds] = useState<ReadonlySet<string>>(new Set());
  const pickerActiveRef = useRef(false);
  pickerActiveRef.current = pickerActive;

  // Handle to the prompt textarea + a live mirror of mode, read
  // synchronously inside the toggle handler (avoids stale-closure reads).
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // The bowtie menu button — an arrow-key stop between prompt and menu.
  const plusRef = useRef<HTMLButtonElement | null>(null);
  const modeRef = useRef<ShellMode>('open');
  if (shell) modeRef.current = shell.mode;

  // Live DOM check instead of focus/blur event tracking: Chrome doesn't fire
  // blur when an element becomes disabled (send disables the textarea), which
  // left the tracked value stale and made ⌘E close instead of refocus.
  const isPromptFocused = () => {
    const el = promptRef.current;
    if (!el) return false;
    return (el.getRootNode() as Document | ShadowRoot).activeElement === el;
  };

  const open = useCallback(() => {
    setFocusOnOpen(true);
    patchShell({ mode: 'open' });
  }, [patchShell]);

  const collapse = useCallback(() => {
    patchShell({ mode: 'collapsed', menuOpen: false });
  }, [patchShell]);

  /**
   * Hotkey behavior:
   * - collapsed        → open and focus the prompt
   * - open, unfocused  → focus the prompt (don't close)
   * - open, focused    → close
   */
  const toggle = useCallback(() => {
    if (modeRef.current === 'collapsed') {
      setFocusOnOpen(true);
      patchShell({ mode: 'open' });
      return;
    }
    if (isPromptFocused()) {
      collapse();
      return;
    }
    // Open but focus is elsewhere — pull focus into the prompt, stay open.
    promptRef.current?.focus();
  }, [collapse, patchShell]);

  const toggleMenu = useCallback(() => {
    if (!shell) return;
    const nextOpen = !shell.menuOpen;
    // Opening straight onto Tasks counts as seeing them.
    if (nextOpen && shell.activeView === 'tasks') markSeen();
    patchShell({ menuOpen: nextOpen });
  }, [shell, patchShell, markSeen]);

  const selectView = useCallback(
    (id: ViewId) => {
      patchShell({ activeView: id });
      if (id === 'tasks') markSeen();
    },
    [patchShell, markSeen],
  );

  // Clicking a toast jumps straight to the Tasks view, anywhere.
  const openTasks = useCallback(() => {
    clearFinished();
    patchShell({ mode: 'open', menuOpen: true, activeView: 'tasks' });
    markSeen();
  }, [clearFinished, patchShell, markSeen]);

  // Best-effort side panel open — the click gesture carries through the
  // message, which Chrome requires for sidePanel.open(). With a reportId,
  // that artifact becomes the panel's active report.
  const openSidePanel = useCallback((reportId?: string) => {
    void browser.runtime
      .sendMessage({ type: MESSAGE.SIDE_PANEL_OPEN, reportId })
      .catch(() => {});
  }, []);

  // A running task's row opens its live activity view in the side panel.
  const openTaskPanel = useCallback((task: Task) => {
    void browser.runtime
      .sendMessage({ type: MESSAGE.SIDE_PANEL_OPEN, taskId: task.id })
      .catch(() => {});
  }, []);

  // A finished global run's task supersedes this tab's tracked run.
  useEffect(() => {
    if (finished && run && finished.id === run.id) clearRun();
  }, [finished, run, clearRun]);

  // First-run onboarding: hand-holds connecting an AI before the prompt
  // takes over. Terminal once finished or skipped.
  const [onboarding, completeOnboarding] = useOnboarding();
  // Chrome's user-scripts toggle, polled live while onboarding shows: the
  // permissions step blocks on it and auto-advances when it flips.
  const userScriptsEnabled = useUserScriptsEnabled(onboarding === 'pending');
  const openUserScriptsSettings = useCallback(() => {
    void browser.runtime
      .sendMessage({ type: MESSAGE.USER_SCRIPTS_SETTINGS_OPEN })
      .catch(() => {});
  }, []);

  // Sign-in gate: popped when a message was rejected for missing auth.
  const [authGate, setAuthGate] = useState(false);

  // Which provider's sign-in pages this tab lives on, if any. On those
  // pages the shell proactively surfaces the in-flight code + instructions.
  const pageProvider = useMemo(
    () => providerForHostname(window.location.hostname),
    [],
  );

  // Provider device-code auth on the sandbox VM, via background. Fetched
  // the first time it's needed: when the Providers view is shown, right
  // away while onboarding still wants a provider, or on a provider's own
  // sign-in pages (to catch a flow started from another tab).
  const providersVisible =
    (shell?.menuOpen === true && shell.activeView === 'providers') ||
    onboarding === 'pending' ||
    pageProvider != null;
  const [codexAuth, connectCodex, setCodexAuth] = useProviderAuth(
    MESSAGE.CODEX_LOGIN_START,
    MESSAGE.CODEX_STATUS_GET,
    providersVisible,
  );
  const [grokAuth, connectGrok] = useProviderAuth(
    MESSAGE.GROK_LOGIN_START,
    MESSAGE.GROK_STATUS_GET,
    providersVisible,
  );
  const [claudeAuth, connectClaude, setClaudeAuth] = useProviderAuth(
    MESSAGE.CLAUDE_LOGIN_START,
    MESSAGE.CLAUDE_STATUS_GET,
    providersVisible,
  );

  // Claude's reverse flow: forward the code the user pasted back. The CLI
  // on the VM finishes the exchange; polling notices the flip to connected.
  const submitClaudeCode = useCallback(
    (code: string) => {
      void browser.runtime
        .sendMessage({ type: MESSAGE.CLAUDE_CODE_SUBMIT, code })
        .then(
          (auth: ProviderAuth) => {
            // A rejected submit (no flow in progress) must surface; a happy
            // "still pending" must NOT clobber the URL already on screen.
            if (auth && auth.status !== 'pending') setClaudeAuth(auth);
          },
          () => setClaudeAuth({ status: 'failed', error: 'Server unreachable' }),
        );
    },
    [setClaudeAuth],
  );

  // Card asks: is this URL the page this tab is on? (The extension runs on
  // the sign-in pages too — the card parks its open button when so.)
  // Matched by provider family, not exact hostname: sign-in flows hop
  // across sibling domains.
  const isThisPage = useCallback((url: string) => {
    const family = (hostname: string) =>
      providerForHostname(hostname) ?? hostname.split('.').slice(-2).join('.');
    try {
      return family(new URL(url).hostname) === family(window.location.hostname);
    } catch {
      return false;
    }
  }, []);

  // On a provider's sign-in pages, a pending login (usually started from
  // another tab) surfaces itself: the shell opens once with the connect
  // card so the code + instructions are right there next to the sign-in
  // form. Once per page load, and without stealing focus from the form.
  const signInNudged = useRef(false);
  const pageAuth =
    pageProvider === 'codex'
      ? codexAuth
      : pageProvider === 'grok'
        ? grokAuth
        : pageProvider === 'claude'
          ? claudeAuth
          : null;
  useEffect(() => {
    if (!pageProvider || signInNudged.current) return;
    if (pageAuth?.status !== 'pending') return;
    signInNudged.current = true;
    if (onboarding !== 'pending') setAuthGate(true);
    patchShell({ mode: 'open' });
  }, [pageProvider, pageAuth?.status, onboarding, patchShell]);

  // One connect entry point for the onboarding card's provider choice.
  const connectProvider = useCallback(
    (provider: 'codex' | 'grok' | 'claude') => {
      if (provider === 'codex') connectCodex();
      else if (provider === 'grok') connectGrok();
      else connectClaude();
    },
    [connectCodex, connectGrok, connectClaude],
  );

  // Shift-click keeps the picker armed so several elements can be
  // collected in one pass; a plain click picks one and returns to the
  // prompt.
  const handlePick = useCallback(
    (element: PickedElement, keepPicking: boolean) => {
      setPicked((current) => [...current, element]);
      if (keepPicking) return;
      setPickerActive(false);
      promptRef.current?.focus();
    },
    [],
  );

  // Watch picked references for deletion: a reference whose fingerprinted
  // resolve fails gets marked missing — chip grays out, highlight stops.
  useEffect(() => {
    if (picked.length === 0) {
      setMissingIds((current) => (current.size > 0 ? new Set() : current));
      return;
    }

    const check = () => {
      setMissingIds((current) => {
        const next = new Set<string>();
        for (const element of picked) {
          if (!resolvePickedElement(element)) next.add(element.id);
        }
        const unchanged =
          next.size === current.size &&
          [...next].every((id) => current.has(id));
        return unchanged ? current : next;
      });
    };

    check();
    const interval = window.setInterval(check, 1000);
    return () => window.clearInterval(interval);
  }, [picked]);

  // True from submit until RUN_START answers. The background checks
  // provider auth against the server before it responds, which can take a
  // couple of seconds — the prompt must read as busy the whole time, not
  // only once the created run comes back.
  const [sending, setSending] = useState(false);

  // The butler is busy somewhere: this tab's run, or any running task
  // (global jobs, other tabs). Drives the bowtie's "working" loop, which
  // is the only progress signal when the shell is collapsed.
  const working =
    sending ||
    run?.status === 'working' ||
    tasks.some((task) => task.status === 'running');

  const handleSend = useCallback(
    (text: string) => {
      // Fresh page snapshot + the picked references, captured at send time.
      // Missing references stay in context — "the buttons that just got
      // deleted" is still meaningful — but flagged so the model knows.
      const page = capturePageContext(
        picked.map((element) => ({
          ...element,
          missing: missingIds.has(element.id),
        })),
      );
      setSending(true);
      void startRun(text, page, replyTaskId ?? undefined)
        .then((result) => {
          if (!result || !('authRequired' in result)) return;
          // Rejected — no AI connected. Put the message back in the box and
          // pop the sign-in gate, already fetching a code.
          patchShell({ draft: text });
          setCodexAuth((current) =>
            result.auth.status === 'unknown' ? current : result.auth,
          );
          setAuthGate(true);
          const live = ['starting', 'pending', 'connected'];
          if (!live.includes(result.auth.status)) connectCodex();
        })
        .finally(() => setSending(false));
      setPicked([]);
      setReplyTaskId(null);
    },
    [picked, missingIds, replyTaskId, startRun, patchShell, connectCodex],
  );

  // Hand a broken extension back to the agent. The prompt carries the
  // stored intent (description) and the script's own diagnosis — together
  // with the page snapshot handleSend attaches, that's the whole repair
  // brief. Sent from this tab so the agent sees the page it broke on.
  const sendExtensionRepair = useCallback(
    (extension: SiteExtension, reason?: string) => {
      clearRepairAsk();
      patchShell({ mode: 'open', menuOpen: false });
      handleSend(
        `My page extension "${extension.name}" (id: ${extension.id}) is broken on this page.` +
          `${reason ? ` Its self-check reported: "${reason}".` : ''}` +
          ` Its purpose: ${extension.description}` +
          ` Please fix it: rewrite the script against the current page and submit an extension outcome with action "update" and that id.`,
      );
    },
    [clearRepairAsk, patchShell, handleSend],
  );

  useEffect(() => {
    const onMessage = (message: WebButlerMessage) => {
      if (message?.type === MESSAGE.TOGGLE) {
        // Chrome consumes our command shortcut before the page sees the
        // keydown, so a recording hotkey field can never capture it. The
        // command still lands here — hand it to the recorder instead of
        // toggling.
        if (hotkeyRecording.active) {
          hotkeyRecording.onCombo?.(COMMAND_COMBO);
          return;
        }
        toggle();
        return;
      }
      if (message?.type === MESSAGE.SET_OPEN) {
        if (message.open) open();
        else collapse();
      }
      if (message?.type === MESSAGE.BROWSER_CURSOR) {
        const cursor = message.cursor;
        if (cursor.kind === 'hide') {
          setGhostCursor((prev) => ({ ...prev, visible: false }));
        } else if (cursor.kind === 'move') {
          setGhostCursor((prev) => ({
            ...prev,
            x: cursor.x,
            y: cursor.y,
            label: cursor.label,
            visible: true,
          }));
        } else {
          // press / type — snap to the point and re-fire the ripple.
          setGhostCursor((prev) => ({
            ...prev,
            x: cursor.x,
            y: cursor.y,
            visible: true,
            pressCount: prev.pressCount + 1,
          }));
        }
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [toggle, open, collapse]);

  // Live mirrors for the close-combo handler: whether a message (answer
  // card) is on screen and whether a task reference is armed. Refs, not
  // deps — the keydown effect shouldn't re-bind on every run update.
  const answerOpenRef = useRef(false);
  answerOpenRef.current = run?.result != null;
  const replyTaskRef = useRef<string | null>(null);
  replyTaskRef.current = replyTaskId;

  useEffect(() => {
    if (!shell) return;

    const dispatchCombo = (event: KeyboardEvent) => {
      if (comboMatches(settings.hotkeyClose, event)) {
        // An open message dismisses first, before anything else closes —
        // then the armed task reference, then the menu, then the shell.
        if (answerOpenRef.current) {
          event.preventDefault();
          clearRun();
          return;
        }
        if (replyTaskRef.current) {
          event.preventDefault();
          setReplyTaskId(null);
          return;
        }
        if (shell.menuOpen) {
          event.preventDefault();
          patchShell({ menuOpen: false });
          // Focus was likely inside the menu — hand it back to the prompt.
          promptRef.current?.focus();
          return;
        }
        if (shell.mode === 'open') {
          event.preventDefault();
          collapse();
        }
        return;
      }

      // Custom primary combos are handled in-page. The default (⌘E) is a
      // browser-level command — Chrome consumes it before the page sees the
      // keydown — so skip it here to avoid double-toggling.
      if (
        settings.hotkeyPrimary !== DEFAULT_SETTINGS.hotkeyPrimary &&
        comboMatches(settings.hotkeyPrimary, event)
      ) {
        event.preventDefault();
        toggle();
      }
    };

    let lastCapsDown = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      // A hotkey field is capturing — don't act on the keys being recorded.
      if (hotkeyRecording.active) return;
      // The picker overlay owns Escape while active (cancels the pick).
      if (pickerActiveRef.current) return;

      if (event.key === 'CapsLock') lastCapsDown = Date.now();
      dispatchCombo(event);
    };

    // CapsLock is asymmetric on macOS: enabling fires only keydown, disabling
    // fires only keyup — so a capslock hotkey must fire from both. On Windows
    // every press fires both; the timestamp guard skips the keyup that
    // belongs to a press the keydown already handled.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'CapsLock') return;
      if (hotkeyRecording.active || pickerActiveRef.current) return;
      if (Date.now() - lastCapsDown < 600) return;
      dispatchCombo(event);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [
    shell,
    collapse,
    toggle,
    patchShell,
    clearRun,
    settings.hotkeyClose,
    settings.hotkeyPrimary,
  ]);

  // Wait for per-tab state before painting — avoids a flash of the default
  // open dock when this tab was actually collapsed. Same for the onboarding
  // flag, so a first-run tab never flashes the prompt before the card.
  if (!shell || onboarding === 'unknown') return null;

  // Hide entirely on excluded sites (checked after hooks so order is stable).
  if (isExcluded(window.location.hostname, settings.excludedSites)) {
    return null;
  }

  const isTop = settings.position.startsWith('top');
  const origin = originFor(settings.position);
  const horizontal = settings.position.split('-')[1];

  // Tab-scoped surface: this run's result, rendered only in its origin tab.
  const answerSlot = (
    <AnimatePresence initial={false}>
      {run?.result ? (
        <motion.div
          key={run.id}
          initial={{ opacity: 0, y: isTop ? -8 : 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={SPRING_UI}
          className={isTop ? 'webbutler:mt-1.5' : 'webbutler:mb-1.5'}
        >
          <AnswerCard
            tier={run.result.tier}
            text={run.result.text}
            title={run.result.title}
            description={run.result.description}
            urlPatterns={run.result.urlPatterns}
            // Live: the card's "active / not running yet" row tracks the
            // Chrome switch, which can flip while the card is up.
            scriptingAllowed={extensionsState.userScriptsAvailable}
            onAllowScripting={openUserScriptsSettings}
            // The card's on/off switch is the same control as the row in
            // the Extensions view — state comes from the synced list, so
            // the freshly installed extension's id resolves live.
            extensionEnabled={
              run.result.extensionId
                ? (extensionsState.extensions.find(
                    (ext) => ext.id === run.result?.extensionId,
                  )?.enabled ?? true)
                : undefined
            }
            onExtensionToggle={
              run.result.extensionId
                ? (enabled) => {
                    const id = run.result?.extensionId;
                    if (id) toggleExtension(id, enabled);
                  }
                : undefined
            }
            hints={run.result.hints}
            choices={run.result.choices}
            choiceMode={run.result.choiceMode}
            choiceSubmitLabel={run.result.choiceSubmitLabel}
            onHint={(hint) => {
              patchShell({ draft: hint });
              promptRef.current?.focus();
            }}
            // Submitting choices is a reply — it starts the next run.
            onSubmitChoices={(selected) =>
              startRun(selected.join(', '), capturePageContext([]))
            }
            onOpenReport={openSidePanel}
            // Error tier: retry re-sends the same prompt (a new run
            // replaces this one); switching lands on the Providers view.
            onRetry={() => handleSend(run.prompt)}
            onSwitchProvider={() => {
              clearRun();
              patchShell({ mode: 'open', menuOpen: true, activeView: 'providers' });
            }}
            onDismiss={clearRun}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  // Sign-in gate: a message was rejected for missing auth — the connect
  // card pops where answers usually land, already fetching a device code.
  const gateSlot = (
    <AnimatePresence initial={false}>
      {authGate ? (
        <motion.div
          key="auth-gate"
          initial={{ opacity: 0, y: isTop ? -8 : 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={SPRING_UI}
          className={isTop ? 'webbutler:mt-1.5' : 'webbutler:mb-1.5'}
        >
          <OnboardingCard
            variant="gate"
            codex={codexAuth}
            grok={grokAuth}
            claude={claudeAuth}
            isThisPage={isThisPage}
            onConnect={connectProvider}
            onSubmitCode={submitClaudeCode}
            onConnected={(provider) => updateSettings({ provider })}
            onSkip={() => setAuthGate(false)}
            onDone={() => {
              setAuthGate(false);
              promptRef.current?.focus();
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  // Global surface: a task finishing off-tab toasts in EVERY tab.
  const toast = (
    <AnimatePresence>
      {finished ? (
        <motion.div
          key={finished.id}
          initial={{ opacity: 0, y: isTop ? -8 : 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={SPRING_UI}
          style={{ width: SHELL_WIDTH }}
        >
          <TaskToast
            task={finished}
            // A task with a report opens the side panel directly; anything
            // else lands on the Tasks list.
            onOpen={
              finished.reportId
                ? () => {
                    openSidePanel(finished.reportId);
                    clearFinished();
                    markSeen();
                  }
                : openTasks
            }
            onDismiss={clearFinished}
          />
        </motion.div>
      ) : null}
      {/* The proactive repair ask: an extension's self-check just failed
          on this page. Stacks with (above/below) the task toast. */}
      {repairAsk ? (
        <motion.div
          key={`repair-${repairAsk.extension.id}-${repairAsk.extension.version}`}
          initial={{ opacity: 0, y: isTop ? -8 : 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={SPRING_UI}
          style={{ width: SHELL_WIDTH }}
        >
          <RepairToast
            extension={repairAsk.extension}
            reason={repairAsk.reason}
            onFix={() =>
              sendExtensionRepair(repairAsk.extension, repairAsk.reason)
            }
            onDismiss={clearRepairAsk}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  // The strip's slice of the session: everything running plus finishes the
  // user hasn't acknowledged yet, newest first. Running rows keep their
  // place in every tab — this is the "what is it doing" surface.
  const stripTasks = tasks
    .filter((task) => task.status === 'running' || !task.seen)
    .slice(0, 4);

  // Task pills and picked-element chips share ONE wrap row above (or
  // below) the prompt: pills fill from the left, chips finish the line on
  // the right. TaskStrip renders `display: contents`, so its pills are
  // items of this row rather than a nested block.
  const contextRow =
    stripTasks.length > 0 || picked.length > 0 ? (
      <div
        className={`webbutler:flex webbutler:w-full webbutler:flex-wrap webbutler:items-center webbutler:gap-1 ${
          isTop ? 'webbutler:mt-1.5' : 'webbutler:mb-1.5'
        }`}
      >
        {stripTasks.length > 0 ? (
          <TaskStrip
            tasks={stripTasks}
            selectedId={replyTaskId}
            onSelect={(task) =>
              setReplyTaskId((current) =>
                current === task.id ? null : task.id,
              )
            }
            onOpen={openTaskPanel}
            onCancel={(task) => cancelTask(task.id)}
            onDismiss={(task) => markTaskSeen(task.id)}
          />
        ) : null}
        {picked.length > 0 ? (
          <div className="webbutler:ml-auto webbutler:min-w-0">
            <ContextChips
              elements={picked}
              missingIds={missingIds}
              onHover={setHoveredChip}
              onJump={(element) => {
                resolvePickedElement(element)?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                });
              }}
              onRemove={(id) => {
                setPicked((current) =>
                  current.filter((element) => element.id !== id),
                );
                setHoveredChip((current) =>
                  current?.id === id ? null : current,
                );
              }}
            />
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    // `wc-dark` flips the --wc-* theme tokens for the whole shell.
    <div
      className={`webbutler:pointer-events-none webbutler:relative webbutler:h-full webbutler:w-full ${
        isDark ? 'wc-dark' : ''
      }`}
      style={{ '--wc-selection': accentColor } as CSSProperties}
    >
      {pickerActive ? (
        <ElementPickerOverlay
          onPick={handlePick}
          onCancel={() => {
            setPickerActive(false);
            promptRef.current?.focus();
          }}
        />
      ) : null}

      {/* The butler's pointer while it drives the page (browser control). */}
      <GhostCursor state={ghostCursor} accentColor={accentColor} />

      {/* Every referenced element keeps a quiet accent selection mark; the one
          whose chip is hovered pulses. Missing references get no mark. */}
      <AnimatePresence>
        {picked
          .filter((element) => !missingIds.has(element.id))
          .map((element) => (
            <ElementHighlight
              key={element.id}
              element={element}
              emphasis={hoveredChip?.id === element.id}
              accentColor={accentColor}
            />
          ))}
      </AnimatePresence>

      {/* `layout` + `layoutDependency` FLIP-animates the dock when the
          Location setting changes, instead of teleporting between corners.
          Centering uses the native CSS `translate` property (Tailwind v4),
          which Motion's transform-based layout animation doesn't clobber. */}
      <motion.div
        layout
        layoutDependency={settings.position}
        transition={SPRING_SHEET}
        className={`webbutler:pointer-events-auto webbutler:fixed webbutler:flex webbutler:flex-col webbutler:gap-1.5 ${
          horizontal === 'left'
            ? 'webbutler:items-start'
            : horizontal === 'right'
              ? 'webbutler:items-end'
              : 'webbutler:items-center'
        } ${POSITION_CLASSES[settings.position]}`}
        style={{ zIndex: 2147483647 }}
      >
        {/* Bottom dock: toast stacks above the shell, away from the edge. */}
        {!isTop ? toast : null}
        <AnimatePresence mode="wait" initial={false}>
          {shell.mode === 'collapsed' ? (
            <motion.div
              key="collapsed"
              variants={shellVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ transformOrigin: origin }}
            >
              <CollapsedPill onOpen={open} unread={unseen} working={working} />
            </motion.div>
          ) : (
            <motion.div
              key="open"
              variants={shellVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ transformOrigin: origin, width: SHELL_WIDTH }}
              className="webbutler:relative"
            >
              {/* The menu surface is absolutely anchored off the dock (above
                  when docked at the bottom, below when docked at the top) so
                  the textbox never reflows when it opens/closes. */}
              <AnimatePresence initial={false}>
                {shell.menuOpen ? (
                  <motion.div
                    key="menu-panel"
                    variants={popoverVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    style={{
                      transformOrigin: isTop ? 'top left' : 'bottom left',
                      zIndex: 1000,
                      height: 0,
                    }}
                    className={`webbutler:absolute webbutler:left-0 webbutler:w-full ${
                      isTop
                        ? 'webbutler:top-[calc(100%+8px)]'
                        : 'webbutler:bottom-[calc(100%+8px)]'
                    }`}
                  >
                    <div
                      className={`webbutler:absolute webbutler:left-0 webbutler:w-full ${
                        isTop ? 'webbutler:top-0' : 'webbutler:bottom-0'
                      }`}
                    >
                      <MenuPanel
                        active={shell.activeView}
                        onSelect={selectView}
                        settings={settings}
                        onSettingsChange={updateSettings}
                        tasks={{
                          items: tasks,
                          onOpenReport: (task) =>
                            openSidePanel(task.reportId),
                          onOpenTask: openTaskPanel,
                          // Retry re-sends the prompt as a fresh run from
                          // this tab; the menu closes so the working prompt
                          // (and the answer, when it lands) is in view.
                          onRetry: (task) => {
                            patchShell({ menuOpen: false });
                            handleSend(task.prompt);
                          },
                          onRemove: (task) => removeTask(task.id),
                          onClear: clearTasks,
                        }}
                        artifacts={{
                          items: artifacts,
                          onOpen: (artifact) => openSidePanel(artifact.id),
                          onRemove: (artifact) => removeArtifact(artifact.id),
                          onClear: clearArtifacts,
                        }}
                        extensions={{
                          state: extensionsState,
                          onToggle: toggleExtension,
                          onDelete: removeExtension,
                          onOpenSettings: openUserScriptsSettings,
                          pageUrl: window.location.href,
                          onFix: sendExtensionRepair,
                        }}
                        providers={{
                          codex: { auth: codexAuth, onConnect: connectCodex },
                          grok: { auth: grokAuth, onConnect: connectGrok },
                          claude: {
                            auth: claudeAuth,
                            onConnect: connectClaude,
                            onSubmitCode: submitClaudeCode,
                          },
                        }}
                        onExitLeft={() => plusRef.current?.focus()}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Answers + the shared task-pill/element-chip row stack away
                  from the screen edge: above the prompt when docked at the
                  bottom, below when docked at top. */}
              {!isTop ? answerSlot : null}
              {!isTop ? gateSlot : null}
              {!isTop ? contextRow : null}

              {onboarding === 'pending' ? (
                // First run: the onboarding card takes the prompt's place
                // until an AI is connected (or the user opts out).
                <OnboardingCard
                  codex={codexAuth}
                  grok={grokAuth}
                  claude={claudeAuth}
                  isThisPage={isThisPage}
                  onConnect={connectProvider}
                  onSubmitCode={submitClaudeCode}
                  onConnected={(provider) => updateSettings({ provider })}
                  userScriptsEnabled={userScriptsEnabled}
                  onOpenUserScriptsSettings={openUserScriptsSettings}
                  onSkip={completeOnboarding}
                  onDone={() => {
                    // Land the user in a focused prompt, ready to type.
                    setFocusOnOpen(true);
                    completeOnboarding();
                  }}
                />
              ) : (
                <PromptPanel
                  value={shell.draft}
                  onValueChange={(draft) => patchShell({ draft })}
                  autoFocus={focusOnOpen}
                  inputRef={promptRef}
                  onArrowLeftAtStart={() => plusRef.current?.focus()}
                  onSubmit={handleSend}
                  // Only the send round-trip blocks the box. Running tasks
                  // no longer hold the prompt hostage — they live on the
                  // strip (statuses, stop, follow-up) while the user types
                  // the next thing.
                  loading={sending}
                  onStop={clearRun}
                  pickerActive={pickerActive}
                  onTogglePicker={() => setPickerActive((current) => !current)}
                  leading={
                    <PlusButton
                      ref={plusRef}
                      unread={unseen}
                      open={shell.menuOpen}
                      working={working}
                      onClick={toggleMenu}
                      onArrowRight={() => promptRef.current?.focus()}
                    />
                  }
                />
              )}

              {isTop ? contextRow : null}
              {isTop ? gateSlot : null}
              {isTop ? answerSlot : null}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Top dock: toast stacks below the shell instead. */}
        {isTop ? toast : null}
      </motion.div>
    </div>
  );
}
