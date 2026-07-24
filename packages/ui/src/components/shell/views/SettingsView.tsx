import { motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { HiXMark } from "react-icons/hi2";
import { SPRING_UI } from "../../../lib/motion";
import {
  ACCENT_OPTIONS,
  comboFromEvent,
  DEFAULT_SETTINGS,
  formatCombo,
  hotkeyRecording,
  normalizeSitePattern,
  type Settings,
  type ShellPosition,
  type ThemePref,
} from "../../../lib/settings";
import { useRovingRows } from "./useRovingRows";
import { MiniButton, ViewBody, ViewFrame } from "./ViewHeader";

const POSITIONS: Array<{ id: ShellPosition; title: string }> = [
  { id: "top-left", title: "Top left" },
  { id: "top-center", title: "Top middle" },
  { id: "top-right", title: "Top right" },
  { id: "bottom-left", title: "Bottom left" },
  { id: "bottom-center", title: "Bottom middle" },
  { id: "bottom-right", title: "Bottom right" },
];

const THEMES: Array<{ id: ThemePref; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Row order for ArrowUp/ArrowDown roving. */
const ROW_COUNT = 8;

type SettingsViewProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** ArrowLeft on a row — focus returns to the sidebar. */
  onExitLeft?: () => void;
  /** True while keyboard/pointer focus is inside the settings pane. */
  focused?: boolean;
  /**
   * "Erase everything": wipe all local state — the signed-in identity,
   * settings, tasks, site extensions — and return to the first-run sign-in.
   * Confirmed with a second click before it fires.
   */
  onResetAll?: () => void;
};

/**
 * Keyboard model ("row based"):
 * - ArrowUp/ArrowDown  move between rows (wrapping)
 * - Space activates every row. ArrowRight/Enter also activate action rows,
 *   but never cycle Location or Theme.
 * - ArrowLeft  back out to the sidebar
 * Mouse still works directly on every control.
 */
export function SettingsView({
  settings,
  onChange,
  onExitLeft,
  focused = false,
  onResetAll,
}: SettingsViewProps) {
  const { rowRefs, focusRow, rowKeyDown } = useRovingRows(
    onResetAll ? ROW_COUNT : ROW_COUNT - 1,
    onExitLeft,
  );
  const siteInputRef = useRef<HTMLInputElement | null>(null);
  const [siteInput, setSiteInput] = useState("");
  const [recordingRow, setRecordingRow] = useState<number | null>(null);
  // First click arms the erase, second fires it; arming decays on its own.
  const [eraseArmed, setEraseArmed] = useState(false);
  const eraseTimer = useRef<number | null>(null);
  // Nothing is selected while focus remains in the sidebar. ArrowRight into
  // the pane (or a direct pointer interaction) establishes the active row.
  const [activeRow, setActiveRow] = useState<number | null>(null);

  const cyclePosition = () => {
    const index = POSITIONS.findIndex((p) => p.id === settings.position);
    onChange({ position: POSITIONS[(index + 1) % POSITIONS.length].id });
  };

  const cycleTheme = () => {
    const index = THEMES.findIndex((t) => t.id === settings.theme);
    onChange({ theme: THEMES[(index + 1) % THEMES.length].id });
  };

  const cycleAccent = () => {
    const index = ACCENT_OPTIONS.findIndex(
      (accent) => accent.id === settings.accent,
    );
    onChange({
      accent: ACCENT_OPTIONS[(index + 1) % ACCENT_OPTIONS.length].id,
    });
  };

  const startRecording = (
    row: number,
    key: "hotkeyPrimary" | "hotkeyClose",
  ) => {
    hotkeyRecording.active = true;
    // Combos consumed by the browser (our own ⌘E command) arrive via the
    // background instead of keydown — record them through this channel.
    hotkeyRecording.onCombo = (combo) => {
      onChange({ [key]: combo });
      stopRecording();
    };
    setRecordingRow(row);
  };

  const stopRecording = () => {
    hotkeyRecording.active = false;
    hotkeyRecording.onCombo = null;
    setRecordingRow(null);
  };

  // Every key — including Escape — is recordable; cancel by clicking away.
  const recordCombo = (
    event: KeyboardEvent<HTMLDivElement>,
    key: "hotkeyPrimary" | "hotkeyClose",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const combo = comboFromEvent(event.nativeEvent);
    if (!combo) return;
    onChange({ [key]: combo });
    stopRecording();
  };

  const addSite = () => {
    const pattern = normalizeSitePattern(siteInput);
    if (!pattern || settings.excludedSites.includes(pattern)) return;
    onChange({ excludedSites: [...settings.excludedSites, pattern] });
    setSiteInput("");
  };

  const resetDefaults = () => {
    onChange({ ...DEFAULT_SETTINGS });
  };

  const requestErase = () => {
    if (eraseArmed) {
      if (eraseTimer.current != null) window.clearTimeout(eraseTimer.current);
      onResetAll?.();
      return;
    }
    setEraseArmed(true);
    // A destructive click shouldn't stay armed forever if abandoned.
    eraseTimer.current = window.setTimeout(() => setEraseArmed(false), 4000);
  };

  const row = (
    index: number,
    label: string,
    activate: () => void,
    control: ReactNode,
    options?: {
      recording?: "hotkeyPrimary" | "hotkeyClose";
      stacked?: boolean;
      spaceOnly?: boolean;
    },
  ) => (
    <div
      ref={rowRefs(index)}
      tabIndex={-1}
      data-wc-row
      onFocusCapture={() => setActiveRow(index)}
      onPointerDown={() => setActiveRow(index)}
      onKeyDown={
        recordingRow === index && options?.recording
          ? (event) => recordCombo(event, options.recording!)
          : rowKeyDown(index, activate, { spaceOnly: options?.spaceOnly })
      }
      // CapsLock never produces a keydown when being turned OFF (macOS) — the
      // keyup is the only signal, so recording listens for it too.
      onKeyUp={
        recordingRow === index && options?.recording
          ? (event) => {
              if (event.key === "CapsLock")
                recordCombo(event, options.recording!);
            }
          : undefined
      }
      onBlur={recordingRow === index ? stopRecording : undefined}
      className={`webbutler:relative webbutler:outline-none ${
        options?.stacked
          ? "webbutler:px-3 webbutler:py-1"
          : "webbutler:flex webbutler:min-h-7 webbutler:items-center webbutler:justify-between webbutler:gap-3 webbutler:px-3 webbutler:py-1"
      }`}
    >
      {focused && activeRow === index ? (
        <motion.span
          layoutId="wc-settings-row-indicator"
          transition={SPRING_UI}
          className="webbutler:absolute webbutler:top-1/2 webbutler:left-1 webbutler:size-1.5 webbutler:-translate-y-1/2 webbutler:rounded-full webbutler:bg-[var(--wc-ink)]"
        />
      ) : null}
      {options?.stacked ? (
        <>
          <p
            className={`webbutler:pb-1 webbutler:text-[11px] ${
              focused && activeRow === index
                ? "webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
                : "webbutler:text-[var(--wc-text-2)]"
            }`}
          >
            {label}
          </p>
          {control}
        </>
      ) : (
        <>
          <span
            className={`webbutler:text-[11px] ${
              focused && activeRow === index
                ? "webbutler:font-semibold webbutler:text-[var(--wc-ink)]"
                : "webbutler:text-[var(--wc-text-2)]"
            }`}
          >
            {label}
          </span>
          {control}
        </>
      )}
    </div>
  );

  const hotkeyChip = (index: number, key: "hotkeyPrimary" | "hotkeyClose") => {
    const recording = recordingRow === index;
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          focusRow(index);
          startRecording(index, key);
        }}
        className={`webbutler:min-w-12 webbutler:cursor-pointer webbutler:rounded-md webbutler:border webbutler:px-1.5 webbutler:py-0.5 webbutler:text-center webbutler:text-[10px] webbutler:transition-colors webbutler:duration-100 ${
          recording
            ? "webbutler:border-[var(--wc-ink)] webbutler:bg-[var(--wc-hover-1)] webbutler:text-[var(--wc-text-3)]"
            : "webbutler:border-[var(--wc-border)] webbutler:text-[var(--wc-ink)] webbutler:hover:border-[var(--wc-border-strong)]"
        }`}
      >
        {recording ? "Press keys…" : formatCombo(settings[key])}
      </button>
    );
  };

  return (
    <ViewFrame label="Settings">
      <ViewBody>
        {row(
          0,
          "Location",
          cyclePosition,
          <div className="webbutler:grid webbutler:grid-cols-3 webbutler:gap-0.5 webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:p-0.5">
            {POSITIONS.map((position) => {
              const isActive = position.id === settings.position;
              return (
                <button
                  key={position.id}
                  type="button"
                  tabIndex={-1}
                  title={position.title}
                  aria-label={position.title}
                  aria-pressed={isActive}
                  onClick={() => onChange({ position: position.id })}
                  className={`webbutler:flex webbutler:h-4 webbutler:w-5 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-[4px] webbutler:transition-colors webbutler:duration-100 ${
                    isActive
                      ? "webbutler:bg-[var(--wc-hover-3)]"
                      : "webbutler:hover:bg-[var(--wc-hover-1)]"
                  }`}
                >
                  <span
                    className={`webbutler:size-1 webbutler:rounded-full ${
                      isActive
                        ? "webbutler:bg-[var(--wc-ink)]"
                        : "webbutler:bg-[var(--wc-text-4)]"
                    }`}
                  />
                </button>
              );
            })}
          </div>,
          { spaceOnly: true },
        )}

        {row(
          1,
          "Theme",
          cycleTheme,
          <div className="webbutler:flex webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:p-0.5">
            {THEMES.map((theme) => {
              const isActive = theme.id === settings.theme;
              return (
                <button
                  key={theme.id}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={isActive}
                  onClick={() => onChange({ theme: theme.id })}
                  className={`webbutler:cursor-pointer webbutler:rounded-[4px] webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:transition-colors webbutler:duration-100 ${
                    isActive
                      ? "webbutler:bg-[var(--wc-hover-3)] webbutler:font-medium webbutler:text-[var(--wc-ink)]"
                      : "webbutler:text-[var(--wc-text-3)] webbutler:hover:text-[var(--wc-ink)]"
                  }`}
                >
                  {theme.label}
                </button>
              );
            })}
          </div>,
          { spaceOnly: true },
        )}

        {row(
          2,
          "Accent",
          cycleAccent,
          <div className="webbutler:flex webbutler:items-center webbutler:gap-1.5">
            {ACCENT_OPTIONS.map((accent) => {
              const isActive = accent.id === settings.accent;
              return (
                <button
                  key={accent.id}
                  type="button"
                  tabIndex={-1}
                  title={accent.label}
                  aria-label={accent.label}
                  aria-pressed={isActive}
                  onClick={() => onChange({ accent: accent.id })}
                  className="webbutler:relative webbutler:size-3.5 webbutler:cursor-pointer webbutler:rounded-full webbutler:border webbutler:border-black/10 webbutler:transition-transform webbutler:duration-100 webbutler:hover:scale-110"
                  style={{ backgroundColor: accent.value }}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="wc-accent-indicator"
                      transition={SPRING_UI}
                      className="webbutler:pointer-events-none webbutler:absolute webbutler:-inset-[2px] webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-ink)]"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>,
          { spaceOnly: true },
        )}

        {row(
          3,
          "Open hotkey",
          () => startRecording(3, "hotkeyPrimary"),
          hotkeyChip(3, "hotkeyPrimary"),
          { recording: "hotkeyPrimary" },
        )}

        {row(
          4,
          "Close hotkey",
          () => startRecording(4, "hotkeyClose"),
          hotkeyChip(4, "hotkeyClose"),
          { recording: "hotkeyClose" },
        )}

        {row(
          5,
          "Excluded websites",
          () => siteInputRef.current?.focus(),
          <>
            <div className="webbutler:flex webbutler:gap-1">
              <input
                ref={siteInputRef}
                type="text"
                value={siteInput}
                placeholder="example.com"
                onChange={(event) => setSiteInput(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    addSite();
                  } else if (
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown"
                  ) {
                    // Leave the input, back onto the row for roving.
                    event.preventDefault();
                    focusRow(5);
                  }
                }}
                className="webbutler:min-w-0 webbutler:flex-1 webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-transparent webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:placeholder:text-[var(--wc-text-4)] webbutler:focus:border-[var(--wc-border-strong)]"
              />
              <MiniButton onClick={addSite}>Add</MiniButton>
            </div>

            {settings.excludedSites.length > 0 ? (
              <div className="webbutler:mt-1.5 webbutler:flex webbutler:flex-wrap webbutler:gap-1">
                {settings.excludedSites.map((site) => (
                  <span
                    key={site}
                    className="webbutler:inline-flex webbutler:items-center webbutler:gap-0.5 webbutler:rounded-full webbutler:bg-[var(--wc-hover-1)] webbutler:py-0.5 webbutler:pr-0.5 webbutler:pl-2 webbutler:text-[10px] webbutler:text-[var(--wc-text-2)]"
                  >
                    {site}
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Remove ${site}`}
                      onClick={() =>
                        onChange({
                          excludedSites: settings.excludedSites.filter(
                            (entry) => entry !== site,
                          ),
                        })
                      }
                      className="webbutler:flex webbutler:size-3.5 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-3)] webbutler:hover:bg-[var(--wc-hover-3)] webbutler:hover:text-[var(--wc-ink)]"
                    >
                      <HiXMark size={9} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </>,
          { stacked: true },
        )}

        {row(
          6,
          "Reset to defaults",
          resetDefaults,
          <MiniButton onClick={resetDefaults}>Reset</MiniButton>,
        )}

        {onResetAll
          ? row(
              7,
              eraseArmed ? "Signs you out. No undo." : "Erase everything",
              requestErase,
              <button
                type="button"
                tabIndex={-1}
                onClick={requestErase}
                className={`webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-md webbutler:border webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:transition-colors webbutler:duration-100 ${
                  eraseArmed
                    ? "webbutler:border-[#e5484d]/60 webbutler:bg-[#e5484d]/10 webbutler:font-medium webbutler:text-[#e5484d]"
                    : "webbutler:border-[var(--wc-border)] webbutler:text-[var(--wc-ink)] webbutler:hover:border-[#e5484d]/50 webbutler:hover:text-[#e5484d]"
                }`}
              >
                {eraseArmed ? "Yes, erase" : "Erase…"}
              </button>,
            )
          : null}
      </ViewBody>
    </ViewFrame>
  );
}
