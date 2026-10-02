import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type {
  AgentId,
  ChatEvent,
  ClientToolName,
  ClientToolResult,
  PageContext,
} from '../shared/protocol.js';
import type { Agent } from './agents.js';
import type { McpBridge, McpResult } from './mcp.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_CONVERSATIONS = 50;
const IDLE_MS = 2 * 60 * 60 * 1000;

export interface Conversation {
  id: string;
  agent: AgentId;
  /** The agent's own session id once its first run has started. */
  session?: string;
  /** A run is in progress. */
  busy: boolean;
  /** Page-tool calls waiting for the browser. */
  pending: Map<string, (result: ClientToolResult) => void>;
  touched: number;
}

export class Conversations {
  private readonly all = new Map<string, Conversation>();

  get(id: string | undefined, agent: AgentId): Conversation {
    const now = Date.now();
    for (const [key, c] of this.all) if (now - c.touched > IDLE_MS && !c.busy) this.all.delete(key);
    const found = id ? this.all.get(id) : undefined;
    if (found && found.agent === agent) {
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
      busy: false,
      pending: new Map(),
      touched: now,
    };
    this.all.set(created.id, created);
    return created;
  }

  find(id: string): Conversation | undefined {
    return this.all.get(id);
  }
}

export interface RunDeps {
  agent: Agent;
  /** The command and leading arguments; default: the agent's binary. */
  command: string[];
  root: string;
  bridge: McpBridge;
  model?: string;
  emit(event: ChatEvent): void;
  /** Aborts when the page goes away; the run is stopped. */
  signal: AbortSignal;
}

function checkToolInput(name: string, input: Record<string, unknown>): string | undefined {
  const text = (key: string) =>
    typeof input[key] === 'string' && (input[key] as string).trim() !== '';
  if (name === 'point_at_element' && !text('prompt')) return 'prompt must be a non-empty string.';
  if (name === 'inspect_element' && !text('id')) return 'id must be a non-empty string.';
  if (name === 'propose_issue' && !(text('title') && text('body')))
    return 'title and body must be non-empty strings.';
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
  return new Promise<McpResult>((resolve) => {
    conversation.pending.set(id, (result) =>
      resolve({ text: result.content, isError: result.isError ?? false }),
    );
    deps.emit({ type: 'client_tool', call: { id, name: name as ClientToolName, input } });
  });
}

/** One message: runs the agent in the background until it answers, streaming what it does. */
export async function runTurn(
  conversation: Conversation,
  text: string,
  page: PageContext,
  deps: RunDeps,
) {
  const { agent } = deps;
  const newSession = randomUUID();
  const message = `<page_context>\n${JSON.stringify(page)}\n</page_context>\n\n${text}`;
  const spec = {
    root: deps.root,
    system: SYSTEM_PROMPT,
    message,
    ...(conversation.session ? { session: conversation.session } : {}),
    newSession,
    mcpUrl: deps.bridge.url(conversation.id),
    mcpToken: deps.bridge.token,
    ...(deps.model ? { model: deps.model } : {}),
  };
  deps.bridge.register(conversation.id, (name, input) =>
    askBrowser(conversation, deps, name, input),
  );

  const [command, ...lead] = deps.command;
  const child = spawn(command!, [...lead, ...agent.args(spec)], {
    cwd: deps.root,
    env: { ...process.env, ...agent.env(spec) },
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
    for (const event of parse(line)) {
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
  deps.bridge.unregister(conversation.id);
  for (const answer of conversation.pending.values())
    answer({ id: '', content: 'The turn ended.', isError: true });
  conversation.pending.clear();
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
