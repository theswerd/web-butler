import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DEFAULT_SETTINGS,
  MenuPanel,
  type Settings,
  type ViewId,
} from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/MenuPanel',
  component: MenuPanel,
} satisfies Meta<typeof MenuPanel>;

export default meta;
type Story = StoryObj;

function MenuPanelDemo() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [active, setActive] = useState<ViewId>('settings');
  return (
    <div style={{ width: 560 }}>
      <MenuPanel
        active={active}
        onSelect={setActive}
        settings={settings}
        onSettingsChange={(patch) =>
          setSettings((current) => ({ ...current, ...patch }))
        }
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <MenuPanelDemo />,
};
