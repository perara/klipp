import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { ChatEvent, ChatInput, ClientToolCall } from '../shared/protocol.js';
import type { Turn } from './llm.js';
import { describeModelError } from './llm.js';
import { SYSTEM_PROMPT } from './prompt.js';
import type { SourceAccess } from './source.js';
import {
  activityLabel,
  InputError,
  isClientTool,
  runServerTool,
  TOOLS,
  validateClientInput,
} from './tools.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const MAX_STEPS = 16;
const MAX_CONVERSATIONS = 50;
const IDLE_MS = 2 * 60 * 60 * 1000;

export interface Conversation {
  id: string;
  /** Only ever appended to, so the model's thinking blocks stay valid. */
  messages: MessageParam[];
  /** Tool calls the browser is answering, and the server results that go in the same message. */
  pending?: { calls: ClientToolCall[]; serverResults: ToolResult[] };
  busy: boolean;
  touched: number;
}

export class Conversations {
  private readonly all = new Map<string, Conversation>();

  get(id: string | undefined): Conversation {
    const now = Date.now();
    for (const [key, c] of this.all) if (now - c.touched > IDLE_MS) this.all.delete(key);
    const found = id ? this.all.get(id) : undefined;
    if (found) {
      found.touched = now;
      return found;
    }
    if (this.all.size >= MAX_CONVERSATIONS) {
      const oldest = [...this.all.values()].sort((a, b) => a.touched - b.touched)[0]!;
      this.all.delete(oldest.id);
    }
    const created: Conversation = { id: randomUUID(), messages: [], busy: false, touched: now };
    this.all.set(created.id, created);
    return created;
  }
}

export interface AgentDeps {
  turn: Turn;
  source: SourceAccess;
  emit(event: ChatEvent): void;
}

const result = (id: string, content: string, isError = false): ToolResult => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  ...(isError ? { is_error: true } : {}),
});

/** The user's side of the next exchange: answers to pending tool calls first, then what they typed. */
function userContent(conversation: Conversation, input: ChatInput): ContentParam[] {
  const content: ContentParam[] = [];
  const pending = conversation.pending;
  if (pending) {
    const answers = new Map(
      input.type === 'tool_results' ? input.results.map((r) => [r.id, r] as const) : [],
    );
    content.push(...pending.serverResults);
    for (const call of pending.calls) {
      const answer = answers.get(call.id);
      content.push(
        answer
          ? result(call.id, answer.content, answer.isError)
          : result(call.id, 'No answer: the user wrote a new message instead.'),
      );
    }
    conversation.pending = undefined;
  }
  if (input.type === 'text') {
    content.push(
      { type: 'text', text: `<page_context>\n${JSON.stringify(input.page)}\n</page_context>` },
      { type: 'text', text: input.text },
    );
  }
  return content;
}

/** Runs the conversation forward until the model is done or needs the browser. */
export async function advance(conversation: Conversation, input: ChatInput, deps: AgentDeps) {
  const content = userContent(conversation, input);
  if (!content.length) {
    deps.emit({ type: 'error', message: 'There was nothing to answer.' });
    return;
  }
  conversation.messages.push({ role: 'user', content });

  for (let step = 0; step < MAX_STEPS; step++) {
    let message;
    try {
      message = await deps.turn(
        { system: SYSTEM_PROMPT, tools: TOOLS, messages: conversation.messages },
        (delta) => deps.emit({ type: 'text', delta }),
      );
    } catch (error) {
      // The user's message stays; the next one simply follows it, so they can try again.
      deps.emit({ type: 'error', message: describeModelError(error) });
      return;
    }
    conversation.messages.push({ role: 'assistant', content: message.content as ContentParam[] });

    const uses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
    );
    if (message.stop_reason === 'refusal') {
      deps.emit({ type: 'text', delta: "\n\nThat's not something I can help with, sorry." });
      // Any tool call cut off by the refusal still needs an answer before the next turn.
      if (uses.length)
        conversation.pending = {
          calls: [],
          serverResults: uses.map((u) => result(u.id, 'Not run.', true)),
        };
      deps.emit({ type: 'done' });
      return;
    }
    if (!uses.length) {
      deps.emit({ type: 'done' });
      return;
    }

    const serverResults: ToolResult[] = [];
    const calls: ClientToolCall[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      if (message.stop_reason === 'max_tokens') {
        serverResults.push(
          result(use.id, 'The call was cut off before its input was complete.', true),
        );
      } else if (isClientTool(use.name)) {
        try {
          validateClientInput(use.name, input);
          calls.push({ id: use.id, name: use.name, input });
        } catch (error) {
          if (!(error instanceof InputError)) throw error;
          serverResults.push(result(use.id, error.message, true));
        }
      } else {
        deps.emit({ type: 'activity', label: activityLabel(use.name, input) });
        const outcome = await runServerTool(use.name, input, deps.source);
        serverResults.push(result(use.id, outcome.content, outcome.isError));
      }
    }
    if (calls.length) {
      conversation.pending = { calls, serverResults };
      deps.emit({ type: 'client_tools', calls });
      return;
    }
    conversation.messages.push({ role: 'user', content: serverResults });
  }
  deps.emit({
    type: 'text',
    delta: "\n\nI've been going round in circles. Could you tell me more?",
  });
  deps.emit({ type: 'done' });
}
