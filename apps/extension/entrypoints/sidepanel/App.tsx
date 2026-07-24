import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ReportView, TaskActivityView, useIsDark } from '@web-butler/ui';
import {
  MESSAGE,
  type PanelState,
  type WebButlerMessage,
} from '@web-butler/ui/shell';

/**
 * Chrome side panel — two surfaces, one slot, latest-wins:
 *  - 'report': artifact-tier output (long-form reports). The in-page
 *    shell shows a compact handoff card; opening it lands here.
 *  - 'task': a running task's live activity feed, opened from its row in
 *    the Tasks list. Streams while the agent works and settles in place.
 *
 * The background owns the state. Fetch on mount, then live-update while
 * the panel is open (streamed task updates, a new report publishing, the
 * watched task finishing).
 */
function App() {
  const dark = useIsDark('system');
  const [state, setState] = useState<PanelState | null>(null);

  useEffect(() => {
    let mounted = true;
    void browser.runtime
      .sendMessage({ type: MESSAGE.PANEL_GET })
      .then((stored: PanelState | undefined) => {
        if (mounted && stored) setState(stored);
      })
      .catch(() => {});

    const onMessage = (message: WebButlerMessage) => {
      if (message?.type === MESSAGE.PANEL_CHANGED) setState(message.state);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // highlight: links clicked here point at markers living in the active
  // tab's shell — the background relays the focus request over there.
  const focusHighlight = (id: string) =>
    void browser.runtime
      .sendMessage({ type: MESSAGE.HIGHLIGHT_FOCUS, highlightId: id })
      .catch(() => {});

  return (
    <div id="web-butler-root">
      <div className={dark ? 'wc-dark webbutler:h-full' : 'webbutler:h-full'}>
        {state?.kind === 'task' ? (
          <TaskActivityView
            task={state.task}
            updates={state.updates}
            onOpenReport={
              state.task.reportId
                ? () =>
                    void browser.runtime
                      .sendMessage({
                        type: MESSAGE.PANEL_FOCUS_REPORT,
                        reportId: state.task.reportId,
                      })
                      .catch(() => {})
                : undefined
            }
            onOpenExtension={
              state.task.extensionId
                ? () =>
                    void browser.runtime
                      .sendMessage({
                        type: MESSAGE.SHELL_REVEAL_EXTENSION,
                        extensionId: state.task.extensionId,
                      })
                      .catch(() => {})
                : undefined
            }
            onUseSuggestion={(text) =>
              void browser.runtime
                .sendMessage({ type: MESSAGE.SHELL_PREFILL, text })
                .catch(() => {})
            }
            onHighlightLink={focusHighlight}
          />
        ) : state?.kind === 'report' && state.report ? (
          <ReportView
            title={state.report.title}
            description={state.report.description}
            meta={state.report.meta}
            text={state.report.text}
            onHighlightLink={focusHighlight}
          />
        ) : (
          <div className="webbutler:flex webbutler:h-full webbutler:items-center webbutler:justify-center webbutler:px-6 webbutler:text-center webbutler:text-[12px] webbutler:text-[var(--wc-text-3)]">
            No report yet. Ask for something long-form, like extracting a
            table or drafting an email.
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
