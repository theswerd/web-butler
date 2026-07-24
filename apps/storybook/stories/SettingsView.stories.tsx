import type { Meta, StoryObj } from '@storybook/react-vite';
import { DEFAULT_SETTINGS, SettingsView, type Settings } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/SettingsView',
  component: SettingsView,
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj;

function SettingsViewDemo() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  return (
    <div
      style={{ width: 400, height: 180 }}
      className="webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)]"
    >
      <SettingsView
        settings={settings}
        onChange={(patch) =>
          setSettings((current) => ({ ...current, ...patch }))
        }
        focused
        // Real one wipes storage + reloads the extension; click twice to see
        // the armed (red) confirm state.
        onResetAll={() => console.log('erase everything')}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <SettingsViewDemo />,
};
