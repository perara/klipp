import { defineConfig, devices } from '@playwright/test';

const DEV = 'http://127.0.0.1:5281/';
const BUILD = 'http://127.0.0.1:5282/sub/';
/** The dev server as another device sees it: by a name that isn't localhost. */
const REMOTE = 'http://laptop.test:5283/';
const permissions = ['clipboard-read', 'clipboard-write'];
// Software WebGL, for the map and the 3D scene on runners without a GPU.
const launchOptions = { args: ['--enable-unsafe-swiftshader'] };

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
    {
      command: 'npx vite examples/react-app --host 127.0.0.1 --port 5283 --strictPort',
      env: { KLIPP_E2E_REMOTE: '1' },
      url: 'http://127.0.0.1:5283/',
      reuseExistingServer: false,
    },
    {
      command: 'node test/box-server.mjs',
      url: 'http://127.0.0.1:5284/healthz',
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'dev',
      testIgnore: /touch|remote|box/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV, permissions, launchOptions },
    },
    {
      name: 'build',
      testIgnore: /touch|remote|box/,
      use: { ...devices['Desktop Chrome'], baseURL: BUILD, permissions, launchOptions },
    },
    {
      name: 'touch',
      testMatch: /touch/,
      use: { ...devices['Pixel 7'], baseURL: DEV, permissions },
    },
    {
      name: 'box',
      testMatch: /box/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5284/',
        permissions,
        launchOptions,
      },
    },
    {
      name: 'remote',
      testMatch: /remote/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: REMOTE,
        launchOptions: { args: ['--host-resolver-rules=MAP laptop.test 127.0.0.1'] },
      },
    },
  ],
});
