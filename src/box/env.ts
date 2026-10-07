import { homedir } from 'node:os';
import { join } from 'node:path';
import { positive } from '../server/env.js';
import type { BoxOptions } from './server.js';

/**
 * `klipp box`'s settings, from the environment:
 *
 * - `KLIPP_ROOT`: the repository the agents read. Default: the working directory.
 * - `KLIPP_BOX_HOST` (default 127.0.0.1) and `KLIPP_BOX_PORT` (default 8790). In a container,
 *   listen on 0.0.0.0 and publish the port only on the host's 127.0.0.1, or not at all.
 * - `KLIPP_BOX_DATA`: logins, tokens and run logs. Default: `~/.klipp-box`.
 * - `KLIPP_BOX_TOKENS`: `name=token,…` for apps such as Klipp, besides tokens made in the UI.
 * - `KLIPP_BOX_IDENTITY_HEADER`, `KLIPP_BOX_ROLES_HEADER`, required `KLIPP_BOX_REQUIRED_ROLE`, and
 *   `KLIPP_BOX_PUBLIC_HOST`: the owner page behind a sign-in proxy; only the proxy may reach it.
 * - `KLIPP_MAX_RUNS` (default 2) and `KLIPP_MODEL`.
 */
export function boxOptionsFromEnv(env: NodeJS.ProcessEnv, cwd: string): BoxOptions {
  return {
    root: env.KLIPP_ROOT || cwd,
    host: env.KLIPP_BOX_HOST || '127.0.0.1',
    port: positive('KLIPP_BOX_PORT', env.KLIPP_BOX_PORT, 8790),
    data: env.KLIPP_BOX_DATA || join(homedir(), '.klipp-box'),
    maxRuns: positive('KLIPP_MAX_RUNS', env.KLIPP_MAX_RUNS, 2),
    ...(env.KLIPP_BOX_TOKENS ? { tokens: env.KLIPP_BOX_TOKENS } : {}),
    ...(env.KLIPP_BOX_IDENTITY_HEADER !== undefined
      ? {
          identity: {
            header: env.KLIPP_BOX_IDENTITY_HEADER,
            rolesHeader: env.KLIPP_BOX_ROLES_HEADER ?? '',
            requiredRole: env.KLIPP_BOX_REQUIRED_ROLE ?? '',
          },
        }
      : {}),
    ...(env.KLIPP_BOX_PUBLIC_HOST !== undefined ? { publicHost: env.KLIPP_BOX_PUBLIC_HOST } : {}),
    ...(env.KLIPP_MODEL ? { model: env.KLIPP_MODEL } : {}),
  };
}
