import { chmodSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AGENTS } from '../server/agents.js';
import { isLocalName } from '../server/guard.js';
import { json, RequestError } from '../server/http.js';
import { McpBridge } from '../server/mcp.js';
import { commandOf, localRunner } from '../server/runner.js';
import type { AgentId } from '../shared/protocol.js';
import { Logins } from './logins.js';
import { RunLog } from './runlog.js';
import { Tokens } from './tokens.js';
import { createUiApi } from './ui-api.js';
import { createV1 } from './v1.js';

/**
 * Keys that bill an account. The agents sign in with a subscription, so these never reach them;
 * CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`, is a subscription's and stays.
 */
const API_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY'];

export interface BoxOptions {
  /** The repository the agents read, read-only. */
  root: string;
  /** Logins, tokens and run logs. Created 0700. */
  data: string;
  port: number;
  /** Default: `127.0.0.1`. */
  host?: string | undefined;
  /** `name=token,…`: tokens from the environment, such as Klipp's (`KLIPP_BOX_TOKENS`). */
  tokens?: string | undefined;
  /** Runs at once. Default: 2. */
  maxRuns?: number | undefined;
  /** The model when a run names none. */
  model?: string | undefined;
  /** Replace an agent's command and leading arguments, as the tests do. */
  commands?: Partial<Record<AgentId, string[]>> | undefined;
  /** How often an idle stream gets an empty line. Default: 15 s. */
  keepAliveMs?: number | undefined;
  /** How long a tool call may wait for its answer. Default: 30 min. */
  toolTimeoutMs?: number | undefined;
  /** Where the built web UI is. Default: this package's `dist`. */
  assets?: string | undefined;
  version?: string | undefined;
}

export interface BoxServer {
  readonly url: string;
  /** Stops every run, then the server. */
  close(): Promise<void>;
}

/** The AI box: Klipp's agents behind box protocol v1, and (Task 8–9) a web UI to set them up. */
export async function startBox(options: BoxOptions): Promise<BoxServer> {
  mkdirSync(options.data, { recursive: true, mode: 0o700 });
  chmodSync(options.data, 0o700);
  // Every CLI the box starts keeps its login here, apart from the user's own.
  const config = {
    CLAUDE_CONFIG_DIR: join(options.data, 'claude'),
    CODEX_HOME: join(options.data, 'codex'),
  };
  const env: NodeJS.ProcessEnv = { ...process.env, ...config };
  for (const key of API_KEYS) delete env[key];
  for (const dir of Object.values(config)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bridge = new McpBridge(options.version);
  const runner = localRunner({ root: options.root, bridge, env, commands: options.commands });
  const logins = new Logins({ commandOf: (agent) => commandOf(options.commands, agent), env });
  const problem = async (agent: AgentId) =>
    (await runner.problem(agent)) ??
    ((await logins.signedIn(agent))
      ? undefined
      : `${AGENTS[agent].label} isn't signed in. Open the AI box to sign in.`);
  const tokens = new Tokens(options.data, options.tokens);
  const log = new RunLog(options.data);
  const v1 = createV1({
    runner,
    problem,
    tokens,
    log,
    maxRuns: options.maxRuns ?? 2,
    model: options.model,
    keepAliveMs: options.keepAliveMs ?? 15_000,
    toolTimeoutMs: options.toolTimeoutMs ?? 30 * 60_000,
  });
  const ui = createUiApi({ runner, logins, tokens, log });

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?', 1)[0]!;
    const fail = (error: unknown) => {
      if (res.headersSent) res.end();
      else {
        // A bad request is the caller's to fix; anything else is the box's own failure.
        const status = error instanceof RequestError ? 400 : 500;
        json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
    };
    if (req.method === 'GET' && path === '/healthz') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('ok');
      return;
    }
    if (path.startsWith('/v1/')) {
      v1.handle(req, res, path).catch(fail);
      return;
    }
    if (path === '/' || path.startsWith('/ui/')) {
      if (!isLocalName(req)) {
        json(res, 403, { error: 'The AI box answers its web UI only at localhost.' });
        return;
      }
      if (path.startsWith('/ui/api/')) {
        ui.handle(req, res, path).then((handled) => {
          if (!handled) json(res, 404, { error: 'No such endpoint.' });
        }, fail);
        return;
      }
    }
    json(res, 404, { error: 'No such page.' });
  });
  await new Promise<void>((done, failed) => {
    server.once('error', failed);
    server.listen(options.port, options.host ?? '127.0.0.1', () => done());
  });
  const { port } = server.address() as AddressInfo;
  const host = options.host ?? '127.0.0.1';
  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    async close() {
      v1.close();
      logins.close();
      bridge.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}
