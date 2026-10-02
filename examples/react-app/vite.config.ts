import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The built package, exactly as an app that installs Klipp would load it.
import klipp, { type IssueDraft } from '../../dist/vite/index.js';

// A stand-in for `claude` and `codex`, so the tests need no login.
const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
let filed = 0;
const fakeFileIssue = async (_draft: IssueDraft) =>
  `https://github.com/example/app/issues/${++filed}`;

export default defineConfig({
  base: process.env.EXAMPLE_BASE ?? '/',
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
        : { commands: { claude: fakeAgent, codex: fakeAgent }, fileIssue: fakeFileIssue },
    }),
  ],
});
