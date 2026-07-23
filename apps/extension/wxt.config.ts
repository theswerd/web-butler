import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * Tailwind still emits runtime vars as --tw-*. Rename them so inherited
 * host-page custom properties cannot bleed into our shadow UI.
 */
function renameTwCssVars(): Plugin {
  return {
    name: 'web-butler-rename-tw-vars',
    enforce: 'post',
    transform(code, id) {
      if (!id.includes('.css')) return null;
      if (!code.includes('--tw-')) return null;
      return code.replaceAll('--tw-', '--web-butler-tw-');
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && typeof chunk.source === 'string') {
          if (chunk.fileName.endsWith('.css') && chunk.source.includes('--tw-')) {
            chunk.source = chunk.source.replaceAll('--tw-', '--web-butler-tw-');
          }
        }
      }
    },
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss(), renameTwCssVars()],
  }),
  manifest: {
    name: 'Web Butler',
    description: 'Your butler for the web, an in-page agent on every site',
    // userScripts backs site extensions (agent-authored page mods); tabs +
    // host_permissions let the background find open tabs matching an
    // extension's URL patterns and inject/revert without a reload. debugger
    // backs browser control: the agent drives the active tab (CDP input +
    // DOM snapshots) behind a visible ghost cursor.
    permissions: [
      'storage',
      'sidePanel',
      'userScripts',
      'tabs',
      'debugger',
      // OS notifications for tasks that finish while no shell is showing.
      'notifications',
    ],
    host_permissions: ['<all_urls>'],
    commands: {
      // Command id predates the rename; keeping it stable preserves any
      // shortcut customization users made under chrome://extensions/shortcuts.
      'web-butler-toggle': {
        suggested_key: {
          default: 'Ctrl+E',
          mac: 'Command+E',
        },
        description: 'Toggle Web Butler',
      },
    },
  },
});
