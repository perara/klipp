import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  ChatEvent,
  ClientToolName,
  ClientToolResult,
  PageContext,
} from '../shared/protocol.js';
import { ticketProblems, type Ticket } from '../shared/ticket.js';
import type { McpResult } from './mcp.js';
import { PAGE_TOOLS, SYSTEM_PROMPT } from './prompt.js';
import type { Runner } from './runner.js';

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
  runner: Runner;
  agent: AgentId;
  model?: string | undefined;
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

/** One message: runs the agent in the background until it answers, streaming what it does. */
export async function runTurn(
  conversation: Conversation,
  text: string,
  page: PageContext,
  deps: RunDeps,
) {
  try {
    await deps.runner.run(
      {
        agent: deps.agent,
        system: SYSTEM_PROMPT,
        message: pageMessage(page, text),
        session: conversation.session,
        model: deps.model,
        tools: PAGE_TOOLS,
      },
      {
        onEvent: (event) => {
          if (event.type === 'session') conversation.session = event.id;
          else deps.emit(event);
        },
        onTool: (name, input) => askBrowser(conversation, deps, name, input),
        signal: deps.signal,
      },
    );
  } finally {
    for (const answer of conversation.pending.values())
      answer({ id: '', content: 'The turn ended.', isError: true });
    conversation.pending.clear();
    conversation.proposals.clear();
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
