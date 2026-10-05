// The AI box for the end-to-end tests: fake agents, a throwaway data folder, Codex already
// signed in and Claude not, and the token the example app uses.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBox } from '../dist/box/server.js';

const fake = [process.execPath, fileURLToPath(new URL('./fake-agent.mjs', import.meta.url))];
// Codex's fake device sign-in waits a minute, so the test can cancel it.
process.env.CODEX_FAKE_DEVICE_MS = '60000';
const data = mkdtempSync(join(tmpdir(), 'klipp-box-e2e-'));
const cleanUp = () => rmSync(data, { recursive: true, force: true });
process.on('exit', cleanUp);
mkdirSync(join(data, 'codex'), { recursive: true });
writeFileSync(join(data, 'codex', 'fake-signed-in'), '');
const box = await startBox({
  root: fileURLToPath(new URL('..', import.meta.url)),
  data,
  port: Number(process.env.KLIPP_BOX_PORT ?? 5284),
  tokens: 'example=e2e-box-token-0123456789',
  commands: { claude: fake, codex: fake },
});
// Playwright stops the box with SIGTERM (see playwright.config.ts): the data folder goes first,
// then any sign-in the tests left running is stopped.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanUp();
    void box.close().finally(() => process.exit(0));
  });
}
console.log(`AI box for the e2e tests on ${box.url}`);
