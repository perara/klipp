import { defineConfig, devices } from '@playwright/test';

const DEV = 'http://127.0.0.1:5281/';
const BUILD = 'http://127.0.0.1:5282/sub/';
const permissions = ['clipboard-read', 'clipboard-write'];

/** The example app twice: under the dev server, and as a production build with a base path. */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npx vite examples/react-app --host 127.0.0.1 --port 5281 --strictPort',
      url: DEV,
      reuseExistingServer: false,
    },
    {
      command:
        'npx vite build examples/react-app && npx vite preview examples/react-app --host 127.0.0.1 --port 5282 --strictPort',
      env: { KLIPP: '1', EXAMPLE_BASE: '/sub/' },
      url: BUILD,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'dev',
      testIgnore: /touch/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV, permissions },
    },
    {
      name: 'build',
      testIgnore: /touch/,
      use: { ...devices['Desktop Chrome'], baseURL: BUILD, permissions },
    },
    {
      name: 'touch',
      testMatch: /touch/,
      use: { ...devices['Pixel 7'], baseURL: DEV, permissions },
    },
  ],
});
