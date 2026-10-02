import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The built package, exactly as an app that installs Klipp would load it.
import klipp, { type IssueDraft } from '../../dist/vite/index.js';

// A stand-in for `claude` and `codex`, so the tests need no login. The README demo uses its own.
const standIn = process.env.KLIPP_DEMO
  ? '../../scripts/demo/demo-agent.mjs'
  : '../../test/fake-agent.mjs';
const fakeAgent = [process.execPath, fileURLToPath(new URL(standIn, import.meta.url))];
let filed = 0;
// The address carries the labels it would have set, for the tests to see (not in the demo).
const fakeFileIssue = (_draft: IssueDraft, labels: string[]) =>
  Promise.resolve(
    process.env.KLIPP_DEMO
      ? 'https://github.com/example/app/issues/42'
      : `https://github.com/example/app/issues/${++filed}#labels=${labels.join(',')}`,
  );

// KLIPP_E2E_REMOTE=1 serves the app to "another device" too, as laptop.test, for the pairing tests.
const remote = Boolean(process.env.KLIPP_E2E_REMOTE);

export default defineConfig({
  base: process.env.EXAMPLE_BASE ?? '/',
  ...(remote ? { server: { allowedHosts: ['laptop.test'] } } : {}),
  plugins: [
    react(),
    klipp({
      // Fixed so the end-to-end tests can check the GitHub links.
      repo: 'https://github.com/example/app',
      commit: '0123456789abcdef0123456789abcdef01234567',
      launcherUnderAutomation: true,
      // KLIPP_REAL_AGENTS=1 runs your real `claude` and `codex` instead.
      chat: process.env.KLIPP_REAL_AGENTS
        ? {}
        : {
            commands: { claude: fakeAgent, codex: fakeAgent },
            fileIssue: fakeFileIssue,
            ...(remote ? { allowRemote: true, pairingCode: 'E2E-PAIR-CODE' } : {}),
          },
    }),
  ],
});
