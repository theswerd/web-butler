import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ANSWER_FIXTURES,
  AnswerCard,
  PromptPanel,
  ReportView,
  popoverVariants,
  type AnswerTier,
} from '@web-butler/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

/**
 * Test harness: canned prompt → response pairs from @web-butler/ui fixtures,
 * rendered as the real stack — answer surface anchored above the prompt pill,
 * exactly how the shell mounts it in-page. Click a prompt to "run" it.
 *
 * Artifact-tier prompts show the in-page handoff card only; hitting "Open"
 * reveals a mock Chrome side panel with the full ReportView, mirroring the
 * real chrome.sidePanel flow.
 */
const meta = {
  title: 'Shell/Answer Scenarios',
  component: AnswerCard,
} satisfies Meta<typeof AnswerCard>;

export default meta;
type Story = StoryObj;

const TIER_LABEL: Record<AnswerTier, string> = {
  status: 'status',
  answer: 'answer',
  artifact: 'report',
  extension: 'extension',
  error: 'error',
};

function ScenarioHarness() {
  const [activeId, setActiveId] = useState<string | null>(
    ANSWER_FIXTURES[0].id,
  );
  const [panelOpen, setPanelOpen] = useState(false);
  /** A clicked hint chip prefills the prompt, like the real shell will. */
  const [draft, setDraft] = useState<string | null>(null);
  const active = ANSWER_FIXTURES.find((f) => f.id === activeId) ?? null;

  const select = (id: string | null) => {
    setActiveId(id);
    setPanelOpen(false);
    setDraft(null);
  };

  return (
    <div
      style={{ width: 560, maxWidth: '100%' }}
      className="webbutler:flex webbutler:flex-col"
    >
      {/* The real stack: answer surface anchored above the pill, exactly
          like the shell's menu slot. */}
      <div className="webbutler:relative webbutler:mb-1.5 webbutler:min-h-[240px]">
        <AnimatePresence mode="wait" initial={false}>
          {active ? (
            <motion.div
              key={active.id}
              variants={popoverVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ transformOrigin: 'bottom left' }}
              className="webbutler:absolute webbutler:bottom-0 webbutler:left-0 webbutler:w-full"
            >
              <AnswerCard
                tier={active.tier}
                title={active.title}
                text={active.text}
                hints={active.hints}
                onHint={setDraft}
                choices={active.choices}
                choiceMode={active.choiceMode}
                choiceSubmitLabel={active.choiceSubmitLabel}
                onSubmitChoices={(picked) =>
                  console.log('[storybook] submitted:', picked)
                }
                onOpenReport={() => setPanelOpen(true)}
                onDismiss={() => select(null)}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <PromptPanel
        value={draft ?? active?.prompt ?? ''}
        onValueChange={setDraft}
        onSubmit={() => {}}
        pickerActive={false}
        onTogglePicker={() => {}}
      />

      {/* Prompt list — pick a canned run. */}
      <div className="webbutler:flex webbutler:flex-col webbutler:gap-0.5 webbutler:pt-5">
        <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
          Test prompts: click to run, click again to dismiss
        </p>
        {ANSWER_FIXTURES.map((fixture) => {
          const isActive = fixture.id === activeId;
          return (
            <button
              key={fixture.id}
              type="button"
              onClick={() => select(isActive ? null : fixture.id)}
              className={`webbutler:flex webbutler:cursor-pointer webbutler:items-baseline webbutler:gap-2 webbutler:rounded-md webbutler:px-2 webbutler:py-1 webbutler:text-left webbutler:text-[12px] webbutler:transition-colors webbutler:duration-100 ${
                isActive
                  ? 'webbutler:bg-[var(--wc-hover-2)] webbutler:text-[var(--wc-ink)]'
                  : 'webbutler:text-[var(--wc-text-3)] webbutler:hover:text-[var(--wc-ink)]'
              }`}
            >
              <span className="webbutler:min-w-0 webbutler:flex-1">
                {fixture.prompt}
              </span>
              <span
                className={`webbutler:shrink-0 webbutler:rounded-full webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:px-1.5 webbutler:py-px webbutler:text-[8px] webbutler:font-medium webbutler:tracking-[0.06em] webbutler:uppercase ${
                  isActive
                    ? 'webbutler:text-[var(--wc-selection)]'
                    : 'webbutler:text-[var(--wc-text-4)]'
                }`}
              >
                {TIER_LABEL[fixture.tier]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mock Chrome side panel — where "Open" on a report handoff lands. */}
      <AnimatePresence>
        {panelOpen && active?.tier === 'artifact' ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="webbutler:pt-5"
          >
            <p className="webbutler:pb-1.5 webbutler:text-[9px] webbutler:font-medium webbutler:tracking-[0.07em] webbutler:text-[var(--wc-text-4)] webbutler:uppercase">
              Chrome side panel (mock)
            </p>
            <div
              style={{ width: 360, height: 480 }}
              className="webbutler:overflow-hidden webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border)] webbutler:shadow-lg"
            >
              <ReportView
                title={active.title ?? 'Report'}
                meta="example.com · just now"
                text={active.text}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const Scenarios: Story = {
  render: () => <ScenarioHarness />,
};
