import type { Meta, StoryObj } from '@storybook/react-vite';
import { PanelEmptyState } from '@web-butler/ui';

/**
 * The side panel before anything has landed: what this surface is for
 * (reports, live task feeds) as ghosted previews, plus example prompts
 * that prefill the shell in the active tab.
 */
const meta = {
  title: 'Report/PanelEmptyState',
  component: PanelEmptyState,
} satisfies Meta<typeof PanelEmptyState>;

export default meta;
type Story = StoryObj;

function Frame({ dark, children }: { dark?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={dark ? 'wc-dark' : undefined}
      style={{
        width: 360,
        height: 520,
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        overflow: 'hidden',
        ['--wc-selection' as string]: '#3b82f6',
      }}
    >
      {children}
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <Frame>
      <PanelEmptyState
        onTryPrompt={(text) => console.log('[storybook] prefill:', text)}
      />
    </Frame>
  ),
};

export const Dark: Story = {
  render: () => (
    <Frame dark>
      <PanelEmptyState
        onTryPrompt={(text) => console.log('[storybook] prefill:', text)}
      />
    </Frame>
  ),
};

/** No prefill route wired — the example prompts drop out; the panel still
    explains itself. */
export const Inert: Story = {
  render: () => (
    <Frame>
      <PanelEmptyState />
    </Frame>
  ),
};
