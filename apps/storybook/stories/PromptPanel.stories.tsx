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
