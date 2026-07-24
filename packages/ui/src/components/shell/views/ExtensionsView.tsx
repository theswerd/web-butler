import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  HiExclamationTriangle,
  HiOutlinePuzzlePiece,
  HiXMark,
} from "react-icons/hi2";
import { matchesAnyPattern } from "../../../lib/match-patterns";
import { SPRING_UI } from "../../../lib/motion";
import type { ExtensionsState, SiteExtension } from "../../../lib/shell";
import { ListNote, ViewBody, ViewEmpty, ViewFrame } from "./ViewHeader";

type ExtensionsViewProps = {
  state: ExtensionsState;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  /** Open chrome://extensions on this extension (user-scripts switch). */
  onOpenSettings?: () => void;
  /** URL of the page the menu is on — enables the "This page" filter. */
  pageUrl?: string;
  /** "Fix" on a broken row — the shell sends the agent a repair prompt,
      seeded with the script's own diagnosis when there is one. */
  onFix?: (extension: SiteExtension, reason?: string) => void;
  /** Land with this extension in view and briefly flashed — set when the
      user arrived via a task row's "View extension" chip. */
  highlightId?: string;
};

/**
 * Chrome's "Allow User Scripts" switch is off: none of the extensions can
 * inject, so everything below this banner is inert until it's flipped. The
 * button opens the exact settings page; the banner clears itself once the
 * switch is on (the shell polls while it's off).
 */
function BlockedBanner({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <div className="webbutler:mx-3 webbutler:mb-1.5 webbutler:flex webbutler:items-start webbutler:gap-2 webbutler:rounded-md webbutler:bg-[rgba(245,158,11,0.12)] webbutler:px-2.5 webbutler:py-2">
      <HiExclamationTriangle
        size={13}
        aria-hidden
        className="webbutler:mt-px webbutler:shrink-0 webbutler:text-[#F59E0B]"
      />
      <div className="webbutler:min-w-0 webbutler:flex-1">
        <p className="webbutler:text-[11px] webbutler:leading-snug webbutler:text-[var(--wc-text-2)]">
          Extensions can't run: Chrome's "Allow User Scripts" switch is off for
          Web Butler.
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="webbutler:mt-1.5 webbutler:cursor-pointer webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-2.5 webbutler:py-1 webbutler:text-[10px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
        >
          Enable in Chrome settings
        </button>
      </div>
    </div>
  );
}

/** "youtube.com +2" — the sites an extension's patterns cover. */
export function hostsLabel(patterns: string[]): string {
  const hosts = [
    ...new Set(
      patterns.map((pattern) => {
        if (pattern === "<all_urls>") return "all sites";
        const match = /^[^:]+:\/\/([^/]+)/.exec(pattern);
        return (match?.[1] ?? pattern).replace(/^\*\./, "");
      }),
    ),
  ];
  if (hosts.length === 0) return "";
  return hosts.length === 1 ? hosts[0] : `${hosts[0]} +${hosts.length - 1}`;
}

/** Small on/off switch, sized to the shell's compact rows. Shared with
    the AnswerCard's extension tier (the "Installed …" card). */
export function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`webbutler:relative webbutler:h-3.5 webbutler:w-6 webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-full webbutler:transition-colors webbutler:duration-150 ${
        on
          ? "webbutler:bg-[var(--wc-selection)]"
          : "webbutler:bg-[var(--wc-border-strong)]"
      }`}
    >
      <span
        aria-hidden
        className={`webbutler:absolute webbutler:top-[2px] webbutler:size-2.5 webbutler:rounded-full webbutler:bg-white webbutler:transition-[left] webbutler:duration-150 ${
          on ? "webbutler:left-[12px]" : "webbutler:left-[2px]"
        }`}
      />
    </button>
  );
}

/** The list's scope filter: everything, or only this page's matches. The
    selected pill slides between tabs (shared layoutId) instead of jumping. */
function FilterTabs({
  filter,
  counts,
  onChange,
}: {
  filter: "page" | "all";
  counts: { page: number; all: number };
  onChange: (next: "page" | "all") => void;
}) {
  const tab = (id: "page" | "all", label: string, count: number) => (
    <button
      type="button"
      aria-pressed={filter === id}
      onClick={() => onChange(id)}
      className={`webbutler:relative webbutler:cursor-pointer webbutler:rounded-full webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:font-medium webbutler:transition-colors webbutler:duration-100 ${
        filter === id
          ? "webbutler:text-[var(--wc-ink)]"
          : "webbutler:text-[var(--wc-text-3)] webbutler:hover:text-[var(--wc-ink)]"
      }`}
    >
      {filter === id ? (
        <motion.span
          layoutId="ext-filter-pill"
          transition={SPRING_UI}
          className="webbutler:absolute webbutler:inset-0 webbutler:rounded-full webbutler:bg-[var(--wc-hover-2)]"
        />
      ) : null}
      <span className="webbutler:relative">
        {label} · {count}
      </span>
    </button>
  );
  return (
    <div className="webbutler:flex webbutler:items-center webbutler:gap-1">
      {tab("page", "This page", counts.page)}
      {tab("all", "All", counts.all)}
    </div>
  );
}

/**
 * The user's site extensions: persistent page modifications the agent
 * installed on request. Each row toggles injection on/off live (open tabs
 * revert immediately) or deletes the extension for good. The same list on
 * every tab; the background owns it and broadcasts changes. A row whose
 * script reported itself broken (its self-check failed after apply) shows
 * the diagnosis and a Fix button that hands the repair to the agent.
 */
export function ExtensionsView({
  state,
  onToggle,
  onDelete,
  onOpenSettings,
  pageUrl,
  onFix,
  highlightId,
}: ExtensionsViewProps) {
  const { extensions, userScriptsAvailable, health } = state;
  const onThisPage = pageUrl
    ? extensions.filter((ext) => matchesAnyPattern(ext.urlPatterns, pageUrl))
    : [];
  // Land on the contextual view when it has anything to show — unless we
  // were sent here to a specific extension that filter would hide.
  const [filter, setFilter] = useState<"page" | "all">(() =>
    onThisPage.length > 0 &&
    (!highlightId || onThisPage.some((ext) => ext.id === highlightId))
      ? "page"
      : "all",
  );

  // The arrival highlight: scroll the target row into view and tint it,
  // then let the tint fade (the row keeps a slow color transition).
  const [flash, setFlash] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!highlightId) return;
    setFlash(highlightId);
    const raf = requestAnimationFrame(() =>
      rowRefs.current[highlightId]?.scrollIntoView({ block: "nearest" }),
    );
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [highlightId]);

  if (extensions.length === 0) {
    return (
      <ViewFrame label="Extensions">
        {!userScriptsAvailable ? (
          <BlockedBanner onOpenSettings={onOpenSettings} />
        ) : null}
        <ViewEmpty icon={HiOutlinePuzzlePiece}>
          No site extensions yet. Ask for a persistent change to any page
          ("always hide the sidebar here") and it will live here.
        </ViewEmpty>
      </ViewFrame>
    );
  }

  const visible = filter === "page" ? onThisPage : extensions;

  return (
    <ViewFrame
      label="Extensions"
      // The scope filter is this page's header action.
      actions={
        pageUrl ? (
          <FilterTabs
            filter={filter}
            counts={{ page: onThisPage.length, all: extensions.length }}
            onChange={setFilter}
          />
        ) : null
      }
    >
      <ViewBody>
        {!userScriptsAvailable ? (
          <BlockedBanner onOpenSettings={onOpenSettings} />
        ) : null}
        {visible.length === 0 ? (
          <ListNote>Nothing applies to this page.</ListNote>
        ) : null}
        {visible.map((ext: SiteExtension) => {
          const broken = ext.enabled && health?.[ext.id]?.status === "broken";
          return (
            <div
              key={ext.id}
              ref={(el) => {
                rowRefs.current[ext.id] = el;
              }}
              className={`webbutler:group webbutler:flex webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-1.5 webbutler:transition-colors webbutler:duration-700 ${
                flash === ext.id
                  ? "webbutler:bg-[color-mix(in_srgb,var(--wc-selection)_14%,transparent)]"
                  : ""
              }`}
            >
              <div className="webbutler:min-w-0 webbutler:flex-1">
                <p
                  className={`webbutler:flex webbutler:items-center webbutler:gap-1 webbutler:truncate webbutler:text-[12px] ${
                    ext.enabled
                      ? "webbutler:font-medium webbutler:text-[var(--wc-ink)]"
                      : "webbutler:text-[var(--wc-text-3)]"
                  }`}
                >
                  {broken ? (
                    <HiExclamationTriangle
                      size={11}
                      aria-label="Broken"
                      className="webbutler:shrink-0 webbutler:text-[#F59E0B]"
                    />
                  ) : null}
                  <span className="webbutler:truncate">{ext.name}</span>
                </p>
                <p className="webbutler:truncate webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
                  {hostsLabel(ext.urlPatterns)} · {ext.description}
                </p>
                {broken ? (
                  <p className="webbutler:mt-0.5 webbutler:flex webbutler:items-center webbutler:gap-1.5 webbutler:text-[10px] webbutler:text-[#B45309]">
                    <span className="webbutler:min-w-0 webbutler:truncate">
                      {/* The script's own diagnosis — the repair's first clue. */}
                      {health?.[ext.id]?.reason ?? "Self-check failed"}
                    </span>
                    {onFix ? (
                      <button
                        type="button"
                        onClick={() => onFix(ext, health?.[ext.id]?.reason)}
                        className="webbutler:shrink-0 webbutler:cursor-pointer webbutler:rounded-full webbutler:bg-[var(--wc-accent)] webbutler:px-2 webbutler:py-0.5 webbutler:text-[9px] webbutler:font-medium webbutler:text-[var(--wc-accent-fg)] webbutler:transition-shadow webbutler:duration-100 webbutler:hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.16)]"
                      >
                        Fix
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="webbutler:flex webbutler:shrink-0 webbutler:items-center webbutler:gap-1.5 webbutler:pt-0.5">
                <Toggle
                  on={ext.enabled}
                  label={`${ext.enabled ? "Disable" : "Enable"} ${ext.name}`}
                  onChange={(next) => onToggle(ext.id, next)}
                />
                <button
                  type="button"
                  aria-label={`Delete ${ext.name}`}
                  onClick={() => onDelete(ext.id)}
                  className="webbutler:flex webbutler:size-4 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded webbutler:text-[var(--wc-text-4)] webbutler:opacity-0 webbutler:transition-opacity webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-1)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
                >
                  <HiXMark size={12} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </ViewBody>
    </ViewFrame>
  );
}
