import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// The built package, exactly as an app that installs Klipp would load it.
import klipp from '../../dist/vite/index.js';

export default defineConfig({
  base: process.env.EXAMPLE_BASE ?? '/',
  plugins: [
    react(),
    klipp({
      // Fixed so the end-to-end tests can check the GitHub links.
      repo: 'https://github.com/example/app',
      commit: '0123456789abcdef0123456789abcdef01234567',
      launcherUnderAutomation: true,
    }),
  ],
});
