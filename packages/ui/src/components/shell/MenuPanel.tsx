import { motion } from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  HiCog6Tooth,
  HiDocumentText,
  HiPuzzlePiece,
  HiQueueList,
  HiSparkles,
} from 'react-icons/hi2';
import type { IconType } from 'react-icons';
import { SPRING_UI } from '../../lib/motion';
import type { Settings } from '../../lib/settings';
import type {
  ExtensionsState,
  ProviderAuth,
  Report,
  SiteExtension,
  Task,
  ViewId,
} from '../../lib/shell';
import { ArtifactsView } from './views/ArtifactsView';
import { ExtensionsView } from './views/ExtensionsView';
import { TasksView } from './views/TasksView';
import { ProvidersView } from './views/ProvidersView';
import { SettingsView } from './views/SettingsView';

type MenuItem = {
  id: ViewId;
  label: string;
  icon: IconType;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const SECTIONS: MenuSection[] = [
  {
    title: 'Activity',
    items: [
      { id: 'tasks', label: 'Tasks', icon: HiQueueList },
      { id: 'artifacts', label: 'Artifacts', icon: HiDocumentText },
      { id: 'extensions', label: 'Extensions', icon: HiPuzzlePiece },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { id: 'providers', label: 'Providers', icon: HiSparkles },
      { id: 'settings', label: 'Settings', icon: HiCog6Tooth },
    ],
  },
];

const FLAT_ITEMS = SECTIONS.flatMap((section) => section.items);

type MenuPanelProps = {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  /** The session's tasks for the Tasks view (global, ongoing first). */
  tasks?: Task[];
  /** A task with a report was clicked — the shell opens the side panel. */
  onOpenReport?: (task: Task) => void;
  /** A running task was clicked — its live view opens in the side panel. */
  onOpenTask?: (task: Task) => void;
  /** Retry on a failed/stopped task row — the shell re-sends the prompt. */
  onTaskRetry?: (task: Task) => void;
  /** Trash one task row. */
  onTaskRemove?: (task: Task) => void;
  /** Bulk trash: 'old' clears settled history, 'all' empties the list. */
  onTasksClear?: (mode: 'old' | 'all') => void;
  /** The session's artifacts for the Artifacts view (global, newest first). */
  artifacts?: Report[];
  /** An artifact row was clicked — the shell opens it in the side panel. */
  onOpenArtifact?: (artifact: Report) => void;
  /** Site extensions + injection availability for the Extensions view. */
  extensionsState?: ExtensionsState;
  /** A site extension's switch was flipped. */
  onExtensionToggle?: (id: string, enabled: boolean) => void;
  /** A site extension's delete was clicked. */
  onExtensionDelete?: (id: string) => void;
  /** "Enable in Chrome settings" on the user-scripts-off banner. */
  onOpenUserScriptsSettings?: () => void;
  /** Current page URL — powers the Extensions view's "This page" filter. */
  pageUrl?: string;
  /** "Fix" on a broken extension row — the shell sends a repair prompt. */
  onExtensionFix?: (extension: SiteExtension) => void;
  /** Codex device-auth state for the Providers view. */
  codexAuth?: ProviderAuth;
  /** Connect clicked on the ChatGPT row — the shell starts the device flow. */
  onCodexConnect?: () => void;
  /** Grok device-auth state for the Providers view. */
  grokAuth?: ProviderAuth;
  /** Connect clicked on the Grok row — the shell starts the device flow. */
  onGrokConnect?: () => void;
  /** Claude auth state for the Providers view (reverse code flow). */
  claudeAuth?: ProviderAuth;
  /** Connect clicked on the Claude row — the shell starts the flow. */
  onClaudeConnect?: () => void;
  /** The user pasted Anthropic's code into the Claude row. */
  onClaudeSubmitCode?: (code: string) => void;
  /** ArrowLeft on a sidebar row — focus returns to the menu (bowtie) button. */
  onExitLeft?: () => void;
};

/**
 * The menu surface is a fixed height no matter which tab is active — tab
 * content scrolls inside it instead of resizing it. Later this becomes the
 * user-draggable (and persisted) height, adjusted from the top edge.
 */
const MENU_HEIGHT = 180;

/** Sidebar width bounds: the floor keeps the longest label readable, the
    ceiling keeps the view pane useful. Default in DEFAULT_SETTINGS (148). */
const SIDEBAR_MIN = 104;
const SIDEBAR_MAX = 220;

const clampSidebar = (width: number) =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));

/**
 * Full-width menu surface: sidebar on the left, the active view's panel on
 * the right. Moving through the sidebar (hover-free, arrow keys, or click)
 * switches the panel in place — there is no separate "menu then view" step.
 */
export function MenuPanel({
  active,
  onSelect,
  settings,
  onSettingsChange,
  tasks = [],
  onOpenReport,
  onOpenTask,
  onTaskRetry,
  onTaskRemove,
  onTasksClear,
  artifacts = [],
  onOpenArtifact,
  extensionsState = { extensions: [], userScriptsAvailable: true },
  onExtensionToggle,
  onExtensionDelete,
  onOpenUserScriptsSettings,
  pageUrl,
  onExtensionFix,
  codexAuth,
  onCodexConnect,
  grokAuth,
  onGrokConnect,
  claudeAuth,
  onClaudeConnect,
  onClaudeSubmitCode,
  onExitLeft,
}: MenuPanelProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [focusRegion, setFocusRegion] = useState<'sidebar' | 'pane' | null>(null);

  // Set when a task row's "View extension" chip sends the user to the
  // Extensions view — that specific row scrolls into view and flashes.
  // Cleared as soon as they browse elsewhere so a later plain visit to
  // Extensions doesn't replay the highlight.
  const [highlightExtensionId, setHighlightExtensionId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (active !== 'extensions') setHighlightExtensionId(null);
  }, [active]);

  // Sidebar/pane divider drag. Width follows the pointer live via local
  // state; the settled value persists to settings on release only (one
  // storage write per drag, not per pixel).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const sidebarWidth =
    dragWidth ?? clampSidebar(settings.menuSidebarWidth ?? 148);
  const dragging = dragWidth !== null;

  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    // Local tracker, not state: pointercancel carries no useful position,
    // and the closure would only see the stale first value anyway.
    let current = startWidth;
    setDragWidth(startWidth);
    const target = event.currentTarget;
    const onMove = (move: PointerEvent) => {
      current = clampSidebar(startWidth + (move.clientX - startX));
      setDragWidth(current);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      onSettingsChange({ menuSidebarWidth: current });
      setDragWidth(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  /** ArrowRight from the sidebar: focus the first row inside the view pane. */
  const enterPane = () => {
    paneRef.current?.querySelector<HTMLElement>('[data-wc-row]')?.focus();
  };

  /** ArrowLeft from inside the pane: back to the active sidebar row. */
  const focusSidebar = () => {
    const index = FLAT_ITEMS.findIndex((item) => item.id === active);
    itemRefs.current[Math.max(index, 0)]?.focus();
  };

  // Focus the active row when the panel opens.
  useEffect(() => {
    const index = FLAT_ITEMS.findIndex((item) => item.id === active);
    const raf = requestAnimationFrame(() =>
      itemRefs.current[Math.max(index, 0)]?.focus(),
    );
    return () => cancelAnimationFrame(raf);
    // Mount-only: refocusing on every selection change would fight the mouse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectByIndex = (index: number) => {
    const count = FLAT_ITEMS.length;
    const next = ((index % count) + count) % count;
    itemRefs.current[next]?.focus();
    onSelect(FLAT_ITEMS[next].id);
  };

  const onItemKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectByIndex(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectByIndex(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectByIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectByIndex(FLAT_ITEMS.length - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      enterPane();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onExitLeft?.();
    }
  };

  let itemIndex = -1;

  // Extensions exist but Chrome's user-scripts switch is off — every one of
  // them is silently inert, which deserves a mark before the view is even
  // opened (the view itself carries the full banner + fix button).
  const extensionsBlocked =
    !extensionsState.userScriptsAvailable &&
    extensionsState.extensions.length > 0;

  return (
    <div
      style={{ height: MENU_HEIGHT }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusRegion(null);
        }
      }}
      className="webbutler:flex webbutler:w-full webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)] webbutler:backdrop-blur-2xl webbutler:backdrop-saturate-150"
    >
      {/* Sidebar — width is user-draggable via the divider next to it. */}
      <nav
        aria-label="Web Butler menu"
        onFocusCapture={() => setFocusRegion('sidebar')}
        onPointerDownCapture={() => setFocusRegion('sidebar')}
        style={{ width: sidebarWidth }}
        className="webbutler:shrink-0 webbutler:overflow-y-auto webbutler:py-1.5"
      >
        {SECTIONS.map((section, sectionIndex) => (
          <div
            key={section.title}
            className={sectionIndex > 0 ? 'webbutler:mt-0.5' : undefined}
          >
            <p className="webbutler:px-3 webbutler:pt-1 webbutler:pb-0.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
              {section.title}
            </p>

            {section.items.map((item) => {
              const Icon = item.icon;
              itemIndex += 1;
              const index = itemIndex;
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  tabIndex={isActive ? 0 : -1}
                  aria-current={isActive ? 'true' : undefined}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  onKeyDown={(event) => onItemKeyDown(event, index)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(item.id);
                  }}
                  className={`webbutler:relative webbutler:flex webbutler:w-full webbutler:cursor-pointer webbutler:select-none webbutler:items-center webbutler:gap-2 webbutler:px-3 webbutler:py-1.5 webbutler:text-left webbutler:text-[12px] webbutler:outline-none webbutler:transition-colors webbutler:duration-100 ${
                    isActive
                      ? 'webbutler:font-medium webbutler:text-[var(--wc-ink)]'
                      : 'webbutler:text-[var(--wc-text-3)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:text-[var(--wc-ink)]'
                  }`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="wc-menu-indicator"
                      transition={SPRING_UI}
                      className={`webbutler:absolute webbutler:inset-y-0 webbutler:left-1 webbutler:my-auto webbutler:h-3.5 webbutler:w-[2px] webbutler:rounded-full webbutler:bg-[var(--wc-ink)] webbutler:transition-opacity webbutler:duration-150 ${
                        focusRegion === 'sidebar'
                          ? 'webbutler:opacity-100'
                          : 'webbutler:opacity-25'
                      }`}
                    />
                  ) : null}
                  {/* currentColor: icon tracks the row's text color (hover + active). */}
                  <span className="webbutler:pointer-events-none webbutler:flex webbutler:size-3.5 webbutler:shrink-0 webbutler:items-center webbutler:justify-center">
                    <Icon size={14} aria-hidden />
                  </span>
                  {item.label}
                  {item.id === 'extensions' && extensionsBlocked ? (
                    <span
                      aria-hidden
                      className="webbutler:ml-auto webbutler:size-1.5 webbutler:shrink-0 webbutler:rounded-full webbutler:bg-[#F59E0B]"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Divider: the hairline between sidebar and pane, draggable to
          resize the sidebar (double-click resets). The visible line is
          1px; the grab zone extends 3px each side of it. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize menu sidebar"
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={-1}
        onPointerDown={onDividerPointerDown}
        onDoubleClick={() => onSettingsChange({ menuSidebarWidth: 148 })}
        className="webbutler:relative webbutler:w-px webbutler:shrink-0 webbutler:cursor-col-resize webbutler:bg-[var(--wc-border-hairline)]"
        style={dragging ? { backgroundColor: 'var(--wc-border-strong)' } : undefined}
      >
        <div
          aria-hidden
          className="webbutler:absolute webbutler:inset-y-0 webbutler:-left-[3px] webbutler:-right-[3px]"
        />
      </div>

      {/* Active view pane — fills the fixed frame; content scrolls inside. */}
      <div
        key={active}
        ref={paneRef}
        onFocusCapture={() => setFocusRegion('pane')}
        onPointerDownCapture={() => setFocusRegion('pane')}
        className="webbutler:h-full webbutler:min-w-0 webbutler:flex-1"
      >
        {active === 'settings' ? (
          <SettingsView
            settings={settings}
            onChange={onSettingsChange}
            onExitLeft={focusSidebar}
            focused={focusRegion === 'pane'}
          />
        ) : active === 'providers' ? (
          <ProvidersView
            settings={settings}
            onChange={onSettingsChange}
            codex={codexAuth}
            onCodexConnect={onCodexConnect}
            grok={grokAuth}
            onGrokConnect={onGrokConnect}
            claude={claudeAuth}
            onClaudeConnect={onClaudeConnect}
            onClaudeSubmitCode={onClaudeSubmitCode}
            onExitLeft={focusSidebar}
          />
        ) : active === 'tasks' ? (
          <TasksView
            tasks={tasks}
            onOpenReport={onOpenReport}
            onOpenTask={onOpenTask}
            onRetry={onTaskRetry}
            onRemove={onTaskRemove}
            onClear={onTasksClear}
            onOpenExtensions={(extensionId) => {
              setHighlightExtensionId(extensionId);
              onSelect('extensions');
            }}
          />
        ) : active === 'artifacts' ? (
          <ArtifactsView artifacts={artifacts} onOpen={onOpenArtifact} />
        ) : active === 'extensions' ? (
          <ExtensionsView
            state={extensionsState}
            onToggle={(id, enabled) => onExtensionToggle?.(id, enabled)}
            onDelete={(id) => onExtensionDelete?.(id)}
            onOpenSettings={onOpenUserScriptsSettings}
            pageUrl={pageUrl}
            onFix={onExtensionFix}
            highlightId={highlightExtensionId ?? undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
