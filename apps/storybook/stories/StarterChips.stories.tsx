import type { Meta, StoryObj } from '@storybook/react-vite';
import { StarterChips } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/StarterChips',
  component: StarterChips,
} satisfies Meta<typeof StarterChips>;

export default meta;
type Story = StoryObj;

function StarterChipsDemo({ prompts }: { prompts: string[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="webbutler:flex webbutler:w-[420px] webbutler:flex-col webbutler:items-end webbutler:gap-2">
      <StarterChips prompts={prompts} onPick={setPicked} />
      <p className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        {picked ? `prefilled: “${picked}”` : 'tap a chip to prefill'}
      </p>
    </div>
  );
}

/** What the AI generated for a pricing page. */
export const Generated: Story = {
  render: () => (
    <StarterChipsDemo
      prompts={[
        'Compare the Pro and Team plans',
        'Any limits on the free tier?',
        'Which plan fits a 4-person team?',
      ]}
    />
  ),
};

/** A thinner page: the model offered fewer, still page-specific chips. */
export const TwoChips: Story = {
  render: () => (
    <StarterChipsDemo
      prompts={[
        'Summarize the RFC 9110 changes',
        'What breaks for HTTP/1.1 clients?',
      ]}
    />
  ),
};
