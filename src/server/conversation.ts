import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  AgentId,
  ChatEvent,
  ClientToolName,
  ClientToolResult,
  PageContext,
} from '../shared/protocol.js';
import { ticketProblems, type Ticket } from '../shared/ticket.js';
import { childEnv, type Agent, type AgentEvent, type RunSpec } from './agents.js';
import type { McpBridge, McpResult } from './mcp.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_CONVERSATIONS = 50;
const IDLE_MS = 2 * 60 * 60 * 1000;

export interface Conversation {
  id: string;
  agent: AgentId;
  /** Behind a sign-in proxy, the user it belongs to; no one else can carry it on. */
  owner?: string | undefined;
  /** The agent's own session id once its first run has started. */
  session?: string;
  /** A run is in progress. */
  busy: boolean;
  /** Page-tool calls waiting for the browser. */
  pending: Map<string, (result: ClientToolResult) => void>;
  /** Tickets shown to the user and waiting on their decision, by tool-call id. */
  proposals: Map<string, Ticket>;
  touched: number;
}

export class Conversations {
  private readonly all = new Map<string, Conversation>();

  get(id: string | undefined, agent: AgentId, owner?: string): Conversation {
    const now = Date.now();
    for (const [key, c] of this.all) if (now - c.touched > IDLE_MS && !c.busy) this.all.delete(key);
    const found = id ? this.all.get(id) : undefined;
    if (found && found.agent === agent && found.owner === owner) {
      found.touched = now;
      return found;
    }
    if (this.all.size >= MAX_CONVERSATIONS) {
      const oldest = [...this.all.values()]
        .filter((c) => !c.busy)
        .sort((a, b) => a.touched - b.touched)[0];
      if (oldest) this.all.delete(oldest.id);
    }
    const created: Conversation = {
      id: randomUUID(),
      agent,
      owner,
      busy: false,
      pending: new Map(),
      proposals: new Map(),
      touched: now,
    };
    this.all.set(created.id, created);
    return created;
  }

  /** A conversation by id, when it belongs to `owner` (no one, without a sign-in proxy). */
  find(id: string, owner?: string): Conversation | undefined {
    const found = this.all.get(id);
    return found?.owner === owner ? found : undefined;
  }

  /** How many agent runs are going on. */
  running(): number {
    let count = 0;
    for (const conversation of this.all.values()) if (conversation.busy) count++;
    return count;
  }
}

export interface RunDeps {
  agent: Agent;
  /** The command and leading arguments; default: the agent's binary. */
  command: string[];
  root: string;
  bridge: McpBridge;
  model?: string;
  /** Environment variables passed to the agent beyond the ones it needs. */
  passEnv?: readonly string[];
  emit(event: ChatEvent): void;
  /** Aborts when the page goes away; the run is stopped. */
  signal: AbortSignal;
}

function checkToolInput(name: string, input: Record<string, unknown>): string | undefined {
  const text = (key: string) => {
    const value = input[key];
    return typeof value === 'string' && value.trim() !== '';
  };
  if (name === 'point_at_element' && !text('prompt')) return 'prompt must be a non-empty string.';
  if (name === 'inspect_element' && !text('id')) return 'id must be a non-empty string.';
  if (name === 'propose_ticket') {
    const problems = ticketProblems(input);
    if (problems.length) {
      return `Not shown to the user yet: ${problems.join('; ')}. Ask the user for what is missing, one question at a time, then call propose_ticket again.`;
    }
  }
  return undefined;
}

/** Hands a page-tool call to the browser and waits for its answer. */
function askBrowser(
  conversation: Conversation,
  deps: RunDeps,
  name: string,
  input: Record<string, unknown>,
) {
  const problem = checkToolInput(name, input);
  if (problem) return Promise.resolve<McpResult>({ text: problem, isError: true });
  const id = randomUUID();
  if (name === 'propose_ticket') conversation.proposals.set(id, input as unknown as Ticket);
  return new Promise<McpResult>((resolve) => {
    conversation.pending.set(id, (result) => {
      conversation.proposals.delete(id);
      resolve({ text: result.content, isError: result.isError ?? false });
    });
    deps.emit({ type: 'client_tool', call: { id, name: name as ClientToolName, input } });
  });
}

/**
 * The page context as the agent reads it. It comes from the page, so it can't close its own
 * tag: every `<` is escaped, which leaves the JSON as it was.
 */
export function pageMessage(page: PageContext, text: string): string {
  const context = JSON.stringify(page).replace(/</g, '\\u003c');
  return `<page_context>\n${context}\n</page_context>\n\n${text}`;
}

interface Spawned {
  exit: number | null;
  finished: boolean;
  stderr: string;
}

/** Starts the agent's process and streams its events until it exits. */
async function spawnAgent(
  conversation: Conversation,
  spec: RunSpec,
  deps: RunDeps,
): Promise<Spawned> {
  const { agent } = deps;
  const [command, ...lead] = deps.command;
  const child = spawn(command!, [...lead, ...agent.args(spec)], {
    cwd: deps.root,
    env: { ...childEnv(agent, process.env, deps.passEnv), ...agent.env(spec) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stop = () => child.kill('SIGTERM');
  deps.signal.addEventListener('abort', stop);
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(agent.input(spec));

  let finished = false;
  const parse = agent.parser(deps.root);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    // A line the parser can't make sense of is skipped; throwing here would take the dev
    // server down with it.
    let events: AgentEvent[];
    try {
      events = parse(line);
    } catch {
      return;
    }
    for (const event of events) {
      if (event.type === 'session') conversation.session = event.id;
      else {
        if (event.type === 'done' || event.type === 'error') finished = true;
        deps.emit(event);
      }
    }
  });

  const exit = await new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      stderr += error.message;
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
  deps.signal.removeEventListener('abort', stop);
  return { exit, finished, stderr };
}

/** One message: runs the agent in the background until it answers, streaming what it does. */
export async function runTurn(
  conversation: Conversation,
  text: string,
  page: PageContext,
  deps: RunDeps,
) {
  const { agent } = deps;
  // Private to this user (mkdtemp makes it 0700): the run's files, such as Claude's MCP
  // config with the bridge's token, which would otherwise show in the process list.
  const dir = await mkdtemp(join(tmpdir(), 'klipp-run-'));
  const spec: RunSpec = {
    root: deps.root,
    dir,
    system: SYSTEM_PROMPT,
    message: pageMessage(page, text),
    ...(conversation.session ? { session: conversation.session } : {}),
    newSession: randomUUID(),
    mcpUrl: deps.bridge.url(conversation.id),
    mcpToken: deps.bridge.token,
    ...(deps.model ? { model: deps.model } : {}),
    install: agent.install?.(deps.command[0]!) ?? [],
  };
  deps.bridge.register(conversation.id, (name, input) =>
    askBrowser(conversation, deps, name, input),
  );
  let result: Spawned;
  try {
    for (const [name, content] of Object.entries(agent.files?.(spec) ?? {})) {
      await writeFile(join(dir, name), content, { mode: 0o600 });
    }
    result = await spawnAgent(conversation, spec, deps);
  } finally {
    deps.bridge.unregister(conversation.id);
    await rm(dir, { recursive: true, force: true });
    for (const answer of conversation.pending.values())
      answer({ id: '', content: 'The turn ended.', isError: true });
    conversation.pending.clear();
    conversation.proposals.clear();
  }
  const { exit, finished, stderr } = result;
  if (!finished && !deps.signal.aborted) {
    const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
    deps.emit({
      type: 'error',
      message: `${agent.label} stopped${exit === null ? '' : ` (exit ${exit})`}${detail ? `: ${detail}` : '.'}`,
    });
  }
}

/** Delivers the browser's answer to a waiting page-tool call. */
export function answerTool(conversation: Conversation, result: ClientToolResult): boolean {
  const answer = conversation.pending.get(result.id);
  if (!answer) return false;
  conversation.pending.delete(result.id);
  answer(result);
  return true;
}
