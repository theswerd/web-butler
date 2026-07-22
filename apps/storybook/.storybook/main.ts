import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  viteFinal: (viteConfig) => {
    // Same Tailwind v4 pipeline the extension uses — the shared stylesheet
    // carries the webbutler: prefix and @source registration itself.
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    return viteConfig;
  },
};

export default config;
