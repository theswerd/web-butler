import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusButton, PromptPanel } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/PromptPanel',
  component: PromptPanel,
} satisfies Meta<typeof PromptPanel>;

export default meta;
type Story = StoryObj;

function PromptPanelDemo() {
  const [value, setValue] = useState('');
  const [pickerActive, setPickerActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div style={{ width: 560 }}>
      <PromptPanel
        value={value}
        onValueChange={setValue}
        onSubmit={(text) => console.log('[storybook] send', text)}
        pickerActive={pickerActive}
        onTogglePicker={() => setPickerActive((v) => !v)}
        leading={
          <PlusButton
            unread={2}
            open={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
        }
      />
      <p className="webbutler:pt-2 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        Send to see the ghost float + Working shimmer (10s mock run).
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => <PromptPanelDemo />,
};

function NoticeDemo({ notice }: { notice: string }) {
  const [value, setValue] = useState('');
  return (
    <div style={{ width: 560 }}>
      <PromptPanel
        value={value}
        onValueChange={setValue}
        notice={notice}
        leading={<PlusButton unread={0} open={false} onClick={() => {}} />}
      />
      <p className="webbutler:pt-2 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        Typing replaces the notice; it returns when the box empties.
      </p>
    </div>
  );
}

/** The availability notice when the server's health check fails. */
export const ServerUnreachable: Story = {
  render: () => <NoticeDemo notice="Can't reach the Web Butler server" />,
};

/** The availability notice when no AI provider is connected. */
export const NoProvider: Story = {
  render: () => (
    <NoticeDemo notice="No AI connected · connect one under Providers" />
  ),
};
