#!/usr/bin/env node
// `klipp serve`: Klipp's chat as its own server, for a shared environment behind a sign-in
// proxy. Settings come from the environment; see src/server/env.ts or the README.
import { optionsFromEnv } from './server/env.js';
import { serve } from './server/serve.js';

const USAGE = `Usage: klipp serve

Runs Klipp's chat as its own HTTP server, for a shared environment behind a sign-in proxy.
Settings come from the environment: KLIPP_ROOT, KLIPP_PORT, KLIPP_HOST, KLIPP_REPO,
KLIPP_AGENT, KLIPP_MODEL, KLIPP_IDENTITY_HEADER, KLIPP_ALLOW, KLIPP_MESSAGES_PER_HOUR,
KLIPP_MAX_RUNS, KLIPP_PASS_ENV, and a GitHub token (KLIPP_GITHUB_TOKEN). See the README.`;

const [command, ...rest] = process.argv.slice(2);
if (command === '--help' || command === '-h' || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (command !== 'serve' || rest.length) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const options = optionsFromEnv(process.env, process.cwd());
  const server = await serve({
    ...options,
    log: (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
  });
  const who = options.identity
    ? `signed-in users named in ${options.identity.header}`
    : 'this machine only';
  console.log(`Klipp is listening on ${server.url} for ${who}, reading ${options.root}.`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
} catch (error) {
  console.error(`klipp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
