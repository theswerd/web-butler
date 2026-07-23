import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same Tailwind v4 pipeline as the extension and Storybook — the shared
// @web-butler/ui stylesheet carries the webbutler: prefix and @source
// registration itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
