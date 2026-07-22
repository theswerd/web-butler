import type { Meta, StoryObj } from '@storybook/react-vite';
import { CollapsedPill } from '@web-butler/ui';

const meta = {
  title: 'Shell/CollapsedPill',
  component: CollapsedPill,
} satisfies Meta<typeof CollapsedPill>;

export default meta;
type Story = StoryObj;

export const UnreadVariants: Story = {
  render: () => (
    <div className="webbutler:flex webbutler:items-center webbutler:gap-6">
      {[0, 3, 12].map((unread) => (
        <div
          key={unread}
          className="webbutler:flex webbutler:flex-col webbutler:items-center webbutler:gap-2"
        >
          <CollapsedPill onOpen={() => {}} unread={unread} />
          <span className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
            {unread} unread
          </span>
        </div>
      ))}
    </div>
  ),
};

/** A task is running — the bowtie loops its pulled-apart animation. */
export const Working: Story = {
  render: () => <CollapsedPill onOpen={() => {}} working />,
};
