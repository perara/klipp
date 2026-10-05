import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AGENTS } from '../server/agents.js';
import { json, readJson } from '../server/http.js';
import type { McpResult, McpTool } from '../server/mcp.js';
import type { RunRequest, Runner } from '../server/runner.js';
import type { AgentId, AgentsResponse } from '../shared/protocol.js';
import type { RunEntry, RunLog } from './runlog.js';
import type { Tokens } from './tokens.js';

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];
const KIB = 1024;
const MODEL = /^[\w.:[\]-]{1,64}$/;
const SESSION = /^[\w-]{1,128}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_TOOLS = 16;

export interface V1Deps {
  runner: Runner;
  /** Why the agent can't run here, signing in included; undefined when it can. */
  problem(agent: AgentId): Promise<string | undefined>;
  tokens: Tokens;
  log: RunLog;
  maxRuns: number;
  model?: string | undefined;
  keepAliveMs: number;
  toolTimeoutMs: number;
}

interface LiveRun {
  app: string;
  pending: Map<string, (result: McpResult) => void>;
  abort: AbortController;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The run a caller asked for, or what is wrong with the request. */
export function parseRunRequest(body: Record<string, unknown>): RunRequest | string {
  const { agent, system, message, session, model, tools } = body;
  if (typeof agent !== 'string' || !AGENT_IDS.includes(agent as AgentId)) {
    return `agent must be one of ${AGENT_IDS.join(', ')}.`;
  }
  if (typeof system !== 'string' || Buffer.byteLength(system) > 64 * KIB) {
    return 'system must be text of at most 64 KiB.';
  }
  if (typeof message !== 'string' || !message || Buffer.byteLength(message) > 256 * KIB) {
    return 'message must be text of at most 256 KiB.';
  }
  if (session !== undefined && (typeof session !== 'string' || !SESSION.test(session))) {
    return 'session must be a session id.';
  }
  if (model !== undefined && (typeof model !== 'string' || !MODEL.test(model))) {
    return 'model must be a model name.';
  }
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) {
    return `tools must be a list of at most ${MAX_TOOLS}.`;
  }
  const checked: McpTool[] = [];
  for (const tool of tools as unknown[]) {
    if (
      !isRecord(tool) ||
      typeof tool.name !== 'string' ||
      !TOOL_NAME.test(tool.name) ||
      typeof tool.description !== 'string' ||
      !isRecord(tool.inputSchema)
    ) {
      return 'Each tool needs a name (a-z, 0-9, _), a description and an inputSchema object.';
    }
    const name = tool.name;
    if (checked.some((t) => t.name === name)) return `Tool ${name} is listed twice.`;
    checked.push({ name, description: tool.description, inputSchema: tool.inputSchema });
  }
  return {
    agent: agent as AgentId,
    system,
    message,
    tools: checked,
    ...(typeof session === 'string' ? { session } : {}),
    ...(typeof model === 'string' ? { model } : {}),
  };
}

/** Box protocol v1: `/v1/agents`, `/v1/runs`, `/v1/runs/:run/tools/:call`, with a Bearer token. */
export function createV1(deps: V1Deps) {
  const live = new Map<string, LiveRun>();
  const now = () => new Date().toISOString();

  function appOf(req: IncomingMessage): string | undefined {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    return token ? deps.tokens.check(token) : undefined;
  }

  async function agents(res: ServerResponse) {
    const list = await Promise.all(
      AGENT_IDS.map(async (id) => {
        const problem = await deps.problem(id);
        return {
          id,
          label: AGENTS[id].label,
          available: !problem,
          ...(problem ? { problem } : {}),
        };
      }),
    );
    const preferred = list.find((a) => a.available)?.id ?? 'claude';
    json(res, 200, { agents: list, preferred } satisfies AgentsResponse);
  }

  async function run(req: IncomingMessage, res: ServerResponse, app: string) {
    const parsed = parseRunRequest(await readJson(req));
    if (typeof parsed === 'string') return json(res, 400, { error: parsed });
    const problem = await deps.problem(parsed.agent);
    if (problem) return json(res, 409, { error: problem });
    if (live.size >= deps.maxRuns)
      return json(res, 429, { error: 'The AI box is busy; try again shortly.' });
    // A session goes on only for the app that started it; anything else starts a new one.
    const session =
      parsed.session && deps.log.ownerOf(parsed.session) === app ? parsed.session : undefined;
    const request: RunRequest = { ...parsed, session, model: parsed.model ?? deps.model };
    const id = randomUUID();
    // Start the log before taking the slot: if the log can't start, nothing is left behind.
    // The slot check, the log and the slot stay synchronous, so two requests can't both pass.
    let log: RunEntry;
    try {
      log = deps.log.start({
        id,
        app,
        agent: request.agent,
        ...(request.model ? { model: request.model } : {}),
        ...(session ? { session } : {}),
        message: request.message,
        started: now(),
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return json(res, 500, { error: `The AI box can't record the run: ${why}` });
    }
    const entry: LiveRun = { app, pending: new Map(), abort: new AbortController() };
    live.set(id, entry);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    const write = (value: unknown) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(value)}\n`);
    };
    res.on('close', () => entry.abort.abort());
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write('\n');
    }, deps.keepAliveMs);
    let failed = false;
    write({ type: 'run', id });
    try {
      await deps.runner.run(request, {
        onEvent: (event) => {
          if (event.type === 'error') failed = true;
          write(event);
          log.write({ type: 'event', at: now(), event });
        },
        onTool: (name, input) =>
          new Promise<McpResult>((resolve) => {
            const call = randomUUID();
            const finish = (result: McpResult) => {
              clearTimeout(timer);
              if (!entry.pending.delete(call)) return;
              log.write({
                type: 'tool_result',
                at: now(),
                id: call,
                content: result.text,
                isError: result.isError ?? false,
              });
              resolve(result);
            };
            const timer = setTimeout(
              () => finish({ text: 'Nobody answered in time.', isError: true }),
              deps.toolTimeoutMs,
            );
            entry.pending.set(call, finish);
            log.write({ type: 'tool_call', at: now(), id: call, name, input });
            write({ type: 'tool_call', id: call, name, input });
          }),
        signal: entry.abort.signal,
      });
    } catch (error) {
      // Such as the MCP bridge failing to start: the caller hears it instead of a cut stream.
      failed = true;
      write({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(keepAlive);
      for (const finish of [...entry.pending.values()])
        finish({ text: 'The turn ended.', isError: true });
      live.delete(id);
      log.end(entry.abort.signal.aborted ? 'stopped' : failed ? 'error' : 'done');
      res.end();
    }
  }

  async function toolResult(
    req: IncomingMessage,
    res: ServerResponse,
    app: string,
    runId: string,
    call: string,
  ) {
    const entry = live.get(runId);
    if (!entry) return json(res, 404, { error: 'No such run.' });
    if (entry.app !== app) return json(res, 403, { error: 'Another app started this run.' });
    const finish = entry.pending.get(call);
    if (!finish) return json(res, 404, { error: 'No such tool call waiting.' });
    const body = await readJson(req);
    if (typeof body.content !== 'string') return json(res, 400, { error: 'content must be text.' });
    finish({ text: body.content, isError: body.isError === true });
    res.statusCode = 204;
    res.end();
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse, path: string) {
      const app = appOf(req);
      if (!app)
        return json(res, 401, { error: 'A valid token is needed: Authorization: Bearer <token>.' });
      if (req.method === 'GET' && path === '/v1/agents') return agents(res);
      if (req.method === 'POST' && path === '/v1/runs') return run(req, res, app);
      const tool = /^\/v1\/runs\/([\w-]+)\/tools\/([\w-]+)$/.exec(path);
      if (req.method === 'POST' && tool) return toolResult(req, res, app, tool[1]!, tool[2]!);
      json(res, 404, { error: 'No such endpoint.' });
    },
    close() {
      for (const entry of live.values()) entry.abort.abort();
    },
  };
}
