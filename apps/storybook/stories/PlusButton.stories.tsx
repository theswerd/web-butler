import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusButton } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/PlusButton',
  component: PlusButton,
} satisfies Meta<typeof PlusButton>;

export default meta;
type Story = StoryObj;

function PlusButtonDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="webbutler:flex webbutler:items-center webbutler:gap-6">
      <PlusButton unread={0} open={open} onClick={() => setOpen((v) => !v)} />
      <PlusButton unread={4} open={false} onClick={() => {}} />
      <span className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        first toggles open (knot turns accent)
      </span>
    </div>
  );
}

export const Default: Story = {
  render: () => <PlusButtonDemo />,
};
