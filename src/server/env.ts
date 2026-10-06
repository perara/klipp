import { readGit } from '../vite/git.js';
import type { AgentId } from '../shared/protocol.js';
import type { ServeOptions } from './serve.js';

const AGENT_IDS: readonly AgentId[] = ['claude', 'codex'];

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function positive(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${name} must be a whole number above 0.`);
  return number;
}

/**
 * `klipp serve`'s settings, from the environment:
 *
 * - `KLIPP_ROOT`: the repository the agent reads. Default: the working directory.
 * - `KLIPP_PORT` (default 8787) and `KLIPP_HOST` (default 127.0.0.1).
 * - `KLIPP_REPO`: where tickets are filed. Default: from the repository's git remote.
 * - `KLIPP_AGENT` (`claude` or `codex`) and `KLIPP_MODEL`.
 * - `KLIPP_IDENTITY_HEADER`: the header a sign-in proxy names the user in. Needed to listen
 *   beyond this machine. `KLIPP_ALLOW`: who may chat, comma-separated, or `*` (the default).
 *   `KLIPP_MESSAGES_PER_HOUR`: per user, default 30.
 * - `KLIPP_MAX_RUNS`: agent runs at once, default 4. `KLIPP_PASS_ENV`: more variables for the
 *   agent, comma-separated.
 * - `KLIPP_BOX_URL` and `KLIPP_BOX_TOKEN`: run the agents in an AI box (`klipp box`).
 * - GitHub: `KLIPP_GITHUB_TOKEN`, `GITHUB_TOKEN` or `GH_TOKEN`, else the GitHub CLI's login.
 *   Without any, tickets open on GitHub, filled in, for the tester to submit.
 */
export function optionsFromEnv(env: NodeJS.ProcessEnv, cwd: string): ServeOptions {
  const root = env.KLIPP_ROOT || cwd;
  const agent = env.KLIPP_AGENT || undefined;
  if (agent !== undefined && !AGENT_IDS.includes(agent as AgentId)) {
    throw new Error(`KLIPP_AGENT must be one of ${AGENT_IDS.join(', ')}.`);
  }
  const repo = env.KLIPP_REPO || readGit(root, env).repo;
  const header = env.KLIPP_IDENTITY_HEADER?.trim();
  const allow = list(env.KLIPP_ALLOW);
  const passEnv = list(env.KLIPP_PASS_ENV);
  const boxUrl = env.KLIPP_BOX_URL?.trim();
  if (boxUrl && !env.KLIPP_BOX_TOKEN)
    throw new Error('KLIPP_BOX_TOKEN is needed with KLIPP_BOX_URL.');
  return {
    root,
    port: positive('KLIPP_PORT', env.KLIPP_PORT, 8787),
    host: env.KLIPP_HOST || '127.0.0.1',
    env,
    maxRuns: positive('KLIPP_MAX_RUNS', env.KLIPP_MAX_RUNS, 4),
    ...(repo ? { repo } : {}),
    ...(agent ? { agent: agent as AgentId } : {}),
    ...(env.KLIPP_MODEL ? { model: env.KLIPP_MODEL } : {}),
    ...(passEnv.length ? { passEnv } : {}),
    ...(boxUrl ? { box: { url: boxUrl, token: env.KLIPP_BOX_TOKEN! } } : {}),
    ...(header
      ? {
          identity: {
            header,
            allow: allow.length === 0 || allow.includes('*') ? '*' : allow,
            messagesPerHour: positive('KLIPP_MESSAGES_PER_HOUR', env.KLIPP_MESSAGES_PER_HOUR, 30),
          },
        }
      : {}),
  };
}
