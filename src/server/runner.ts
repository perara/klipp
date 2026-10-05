import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentId } from '../shared/protocol.js';
import { AGENTS, childEnv, onPath, type Agent, type AgentEvent, type RunSpec } from './agents.js';
import type { McpBridge, McpResult, McpTool } from './mcp.js';

/** One agent turn as a caller asks for it; the folder, tools policy and sandbox are the runner's. */
export interface RunRequest {
  agent: AgentId;
  system: string;
  message: string;
  /** The agent's own session to carry on, from an earlier run's `session` event. */
  session?: string | undefined;
  model?: string | undefined;
  /** Tools the caller answers, offered to the agent over MCP. */
  tools: McpTool[];
}

export interface RunHooks {
  onEvent(event: AgentEvent): void;
  /** A call to one of the request's tools; may wait as long as the user takes. */
  onTool(name: string, input: Record<string, unknown>): Promise<McpResult>;
  /** Aborting stops the run. */
  signal: AbortSignal;
}

/** Where the agents run: here, as child processes, or in an AI box. */
export interface Runner {
  /** Why the agent can't run, or undefined when it can. */
  problem(agent: AgentId): Promise<string | undefined>;
  /** Runs one turn until it ends, streaming its events; failures arrive as `error` events. */
  run(request: RunRequest, hooks: RunHooks): Promise<void>;
}

export interface LocalRunnerOptions {
  /** The repository the agents read. */
  root: string;
  bridge: McpBridge;
  /** Replace an agent's command and leading arguments, as the tests do. */
  commands?: Partial<Record<AgentId, string[]>> | undefined;
  /** More environment variables to pass to the agent, by name. */
  passEnv?: readonly string[] | undefined;
  /** The environment agents start from. Default: this process's. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Ends an error from a failed login, in place of the agent's advice for a terminal. */
  loginHint?: string | undefined;
}

export const WINDOWS =
  "Klipp's chat runs the agents on macOS and Linux. On Windows, run the dev server in WSL.";

export const commandOf = (commands: LocalRunnerOptions['commands'], agent: AgentId): string[] =>
  commands?.[agent] ?? [AGENTS[agent].binary];

/** How soon a readiness check that failed, such as Codex's sandbox, is run again. */
const RECHECK_MS = 30_000;

interface Spawned {
  exit: number | null;
  finished: boolean;
  stderr: string;
}

/** Starts the agent's process and streams its events until it exits. */
async function spawnAgent(
  agent: Agent,
  command: string[],
  spec: RunSpec,
  env: Record<string, string>,
  hooks: RunHooks,
  loginHint: string | undefined,
): Promise<Spawned> {
  const [binary, ...lead] = command;
  const child = spawn(binary!, [...lead, ...agent.args(spec)], {
    cwd: spec.root,
    env: { ...env, ...agent.env(spec) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stop = () => child.kill('SIGTERM');
  hooks.signal.addEventListener('abort', stop);
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(agent.input(spec));

  let finished = false;
  const parse = agent.parser(spec.root, loginHint);
  createInterface({ input: child.stdout }).on('line', (line) => {
    // A line the parser can't make sense of is skipped; throwing here would take the server down.
    let events: AgentEvent[];
    try {
      events = parse(line);
    } catch {
      return;
    }
    for (const event of events) {
      if (event.type === 'done' || event.type === 'error') finished = true;
      hooks.onEvent(event);
    }
  });

  const exit = await new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      stderr += error.message;
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
  hooks.signal.removeEventListener('abort', stop);
  return { exit, finished, stderr };
}

/** Runs the agents on this machine, as child processes, read-only in `root`. */
export function localRunner(options: LocalRunnerOptions): Runner {
  const env = options.env ?? process.env;
  const windows = process.platform === 'win32' && !options.commands;
  /**
   * Each agent's own check, such as Codex's sandbox: a pass is kept, a failure is checked again
   * after a while (an AppArmor profile may have been loaded since). Installing it is checked
   * each time.
   */
  const readiness = new Map<AgentId, { value: Promise<string | undefined>; until: number }>();

  return {
    problem(id) {
      if (windows) return Promise.resolve(WINDOWS);
      const command = commandOf(options.commands, id);
      if (!onPath(command[0]!, env)) {
        return Promise.resolve(
          `I can't find \`${AGENTS[id].binary}\` on this machine. Install it and log in, then restart the server.`,
        );
      }
      const agent = AGENTS[id];
      if (!agent.ready) return Promise.resolve(undefined);
      const cached = readiness.get(id);
      if (cached && Date.now() < cached.until) return cached.value;
      const check = { value: agent.ready(command, options.root, env), until: Infinity };
      const recheck = () => (check.until = Date.now() + RECHECK_MS);
      void check.value.then((problem) => problem && recheck(), recheck);
      readiness.set(id, check);
      return check.value;
    },

    async run(request, hooks) {
      const agent = AGENTS[request.agent];
      const command = commandOf(options.commands, request.agent);
      await options.bridge.start();
      const id = randomUUID();
      // Private to this user (mkdtemp makes it 0700): the run's files, such as Claude's MCP
      // config with the bridge's token, which would otherwise show in the process list.
      const dir = await mkdtemp(join(tmpdir(), 'klipp-run-'));
      const spec: RunSpec = {
        root: options.root,
        dir,
        system: request.system,
        message: request.message,
        ...(request.session ? { session: request.session } : {}),
        newSession: randomUUID(),
        mcpUrl: options.bridge.url(id),
        mcpToken: options.bridge.token,
        ...(request.model ? { model: request.model } : {}),
        install: agent.install?.(command[0]!) ?? [],
        tools: request.tools,
      };
      options.bridge.register(id, (name, input) => hooks.onTool(name, input), request.tools);
      try {
        for (const [name, content] of Object.entries(agent.files?.(spec) ?? {})) {
          await writeFile(join(dir, name), content, { mode: 0o600 });
        }
        // Stopped while preparing: the abort listener only hears a later abort, so don't start.
        if (hooks.signal.aborted) return;
        const childVars = childEnv(agent, env, options.passEnv ?? []);
        const { exit, finished, stderr } = await spawnAgent(
          agent,
          command,
          spec,
          childVars,
          hooks,
          options.loginHint,
        );
        if (!finished && !hooks.signal.aborted) {
          const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
          hooks.onEvent({
            type: 'error',
            message: `${agent.label} stopped${exit === null ? '' : ` (exit ${exit})`}${detail ? `: ${detail}` : '.'}`,
          });
        }
      } finally {
        options.bridge.unregister(id);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
