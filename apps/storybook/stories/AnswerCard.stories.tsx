import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnswerCard } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/AnswerCard',
  component: AnswerCard,
} satisfies Meta<typeof AnswerCard>;

export default meta;
type Story = StoryObj;

const SHORT_ANSWER = `The subscribe button posts to \`/api/newsletter\` with the email from the form. It's **client-side validated** only: the endpoint accepts any string.`;

const LONG_ANSWER = `This page loads **3 tracking scripts** before first paint. Here's what each one does and where it comes from:

- \`gtag.js\`: Google Analytics 4, loaded from the document head
- \`fbevents.js\`: Meta Pixel, injected by the tag manager
- \`clarity.js\`: Microsoft Clarity session recording

The tag manager itself is configured to fire on every route change, so single-page navigations re-send all three.

If you want to verify, the network panel filter is:

\`\`\`
domain:googletagmanager.com OR domain:connect.facebook.net
\`\`\`

Blocking the tag manager at the network level removes all three since they're loaded through it rather than directly.`;

/** Interactive extension card: the switch flips the active/off row live. */
function ExtensionCardDemo({ scriptingAllowed }: { scriptingAllowed: boolean }) {
  const [enabled, setEnabled] = useState(true);
  return (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="extension"
        text="Installed"
        title="Rainbow post title"
        description="Cycles the post title through rainbow colors on every article page."
        urlPatterns={['*://*.example.com/*']}
        scriptingAllowed={scriptingAllowed}
        extensionEnabled={enabled}
        onExtensionToggle={setEnabled}
        onAllowScripting={() => console.log('[storybook] allow scripting')}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  );
}

/** Extension installed while Chrome allows scripting — green active row,
    and the on/off switch flips it to "Turned off" in place. */
export const ExtensionInstalled: Story = {
  render: () => <ExtensionCardDemo scriptingAllowed />,
};

/** Extension saved but Chrome is blocking scripts — warning + allow button. */
export const ExtensionBlocked: Story = {
  render: () => <ExtensionCardDemo scriptingAllowed={false} />,
};

/** A failed run — no checkmark in sight, and two ways forward. */
export const ErrorState: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="error"
        text="Agent request failed: 500"
        onRetry={() => console.log('[storybook] retry')}
        onSwitchProvider={() => console.log('[storybook] switch provider')}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** One-line side-effect confirmation — a full-width pill matching the prompt box. */
export const Status: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="status"
        text="Header switched to dark. Undo with ⌘Z."
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Short/medium prose — card capped at menu height, scrolls inside. */
export const Answer: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text={SHORT_ANSWER}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Answer with follow-up hint chips — clicking one prefills the prompt. */
export const AnswerWithHints: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text={SHORT_ANSWER}
        hints={['harden the validation', 'show me the endpoint code']}
        onHint={(hint) => console.log('[storybook] hint:', hint)}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Single-select follow-up — pick one, then Submit sends it. */
export const FollowUpChoice: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text="I can do that a few ways. How aggressive should I be?"
        choices={[
          'Hide ads only',
          'Ads + floating widgets and banners',
          'Reader mode: keep just the article',
        ]}
        onSubmitChoices={(picked) => console.log('[storybook] submitted:', picked)}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Single-select with a custom submit label. */
export const FollowUpChoiceWithSubmit: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text="This will reload the page and discard the form you started. Continue?"
        choices={['Reload and continue', 'Keep my draft, skip this step']}
        choiceSubmitLabel="Confirm"
        onSubmitChoices={(picked) => console.log('[storybook] submitted:', picked)}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Multi-select — checkboxes collected and sent together via Submit. */
export const FollowUpMultiChoice: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text="Found **3 trackers**. Which should I block? This persists for future visits."
        choices={['Google Analytics', 'Meta Pixel', 'Microsoft Clarity']}
        choiceMode="multi"
        choiceSubmitLabel="Block selected"
        onSubmitChoices={(picked) => console.log('[storybook] submitted:', picked)}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Same card with enough content to hit the height cap and scroll. */
export const AnswerScrolling: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="answer"
        text={LONG_ANSWER}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};

/** Artifact tier in-page = handoff only; the report renders in the side
    panel (see the ReportView story). */
export const ReportHandoff: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <AnswerCard
        tier="artifact"
        title="Tracking scripts on this page"
        text={LONG_ANSWER}
        onOpenReport={() => console.log('[storybook] open side panel')}
        onDismiss={() => console.log('[storybook] dismiss')}
      />
    </div>
  ),
};
