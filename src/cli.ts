#!/usr/bin/env node
// `klipp serve`: Klipp's chat as its own server, for a shared environment behind a sign-in
// proxy. `klipp box`: the AI box, the agents as a service. Settings come from the environment;
// see src/server/env.ts, src/box/env.ts or the README.
import { boxOptionsFromEnv } from './box/env.js';
import { startBox } from './box/server.js';
import { optionsFromEnv } from './server/env.js';
import { serve } from './server/serve.js';

const USAGE = `Usage: klipp serve | klipp box

klipp serve   Klipp's chat as its own HTTP server, for a shared environment behind a sign-in
              proxy. Settings: KLIPP_ROOT, KLIPP_PORT, KLIPP_HOST, KLIPP_REPO, KLIPP_AGENT,
              KLIPP_MODEL, KLIPP_IDENTITY_HEADER, KLIPP_ALLOW, KLIPP_MESSAGES_PER_HOUR,
              KLIPP_MAX_RUNS, KLIPP_PASS_ENV, KLIPP_BOX_URL, KLIPP_BOX_TOKEN, and a GitHub token
              (KLIPP_GITHUB_TOKEN).
klipp box     The AI box: Claude Code and Codex as a service, with an API for apps and a web page
              to sign the agents in, make tokens and watch runs. Settings: KLIPP_ROOT,
              KLIPP_BOX_HOST, KLIPP_BOX_PORT, KLIPP_BOX_DATA, KLIPP_BOX_TOKENS, KLIPP_MAX_RUNS,
              KLIPP_MODEL. See the README.`;

const [command, ...rest] = process.argv.slice(2);
if (command === '--help' || command === '-h' || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if ((command !== 'serve' && command !== 'box') || rest.length) {
  console.error(USAGE);
  process.exit(2);
}

try {
  let close: () => Promise<void>;
  if (command === 'box') {
    const options = boxOptionsFromEnv(process.env, process.cwd());
    const box = await startBox(options);
    close = () => box.close();
    console.log(
      `The AI box is listening on ${box.url}, reading ${options.root}. Its page is at ${box.url}/ on this machine.`,
    );
  } else {
    const options = optionsFromEnv(process.env, process.cwd());
    const server = await serve({
      ...options,
      log: (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
    });
    close = () => server.close();
    const who = options.identity
      ? `signed-in users named in ${options.identity.header}`
      : 'this machine only';
    const where = options.box ? `the AI box at ${options.box.url}` : options.root;
    console.log(`Klipp is listening on ${server.url} for ${who}, with the agents in ${where}.`);
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
  }
} catch (error) {
  console.error(`klipp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
