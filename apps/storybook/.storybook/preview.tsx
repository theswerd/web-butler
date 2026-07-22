import type { Decorator, Preview } from '@storybook/react-vite';
import { ACCENT_OPTIONS } from '@web-butler/ui';
import type { CSSProperties } from 'react';
import './preview.css';

/**
 * Recreates the environment the content script mounts components into:
 * the #web-butler-root token root (all --wc-* variables), the wc-dark
 * class for the dark palette, and --wc-selection for the accent color.
 */
const withShellChrome: Decorator = (Story, context) => {
  const dark = context.globals.theme === 'dark';
  const accent =
    ACCENT_OPTIONS.find((option) => option.id === context.globals.accent) ??
    ACCENT_OPTIONS[0];

  return (
    <div
      id="web-butler-root"
      style={{ '--wc-selection': accent.value } as CSSProperties}
    >
      <div
        className={dark ? 'wc-dark' : undefined}
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          backgroundColor: dark ? '#111113' : '#f0f0ef',
        }}
      >
        <Story />
      </div>
    </div>
  );
};

const preview: Preview = {
  decorators: [withShellChrome],
  globalTypes: {
    theme: {
      description: 'Shell theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    accent: {
      description: 'Accent color (--wc-selection)',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: ACCENT_OPTIONS.map((option) => ({
          value: option.id,
          title: option.label,
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
    accent: 'blue',
  },
  parameters: {
    layout: 'fullscreen',
  },
};

export default preview;
