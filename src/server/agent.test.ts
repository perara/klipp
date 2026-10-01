import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ChatEvent, PageContext } from '../shared/protocol.js';
import { advance, Conversations } from './agent.js';
import type { Turn, TurnResult } from './llm.js';
import type { SourceAccess } from './source.js';

type Block = Anthropic.Beta.BetaContentBlock;

const page: PageContext = {
  url: 'http://localhost/',
  viewport: '1280×800 @1x',
  colorScheme: 'light',
  userAgent: 'Test',
  recentErrors: [],
  failedRequests: [],
};

const text = (value: string): TurnResult => ({
  content: [{ type: 'text', text: value, citations: null } as Block],
  stop_reason: 'end_turn',
});
const use = (id: string, name: string, input: object): Block =>
  ({ type: 'tool_use', id, name, input }) as Block;

/** A turn that plays back canned responses and records what it was sent. */
function scripted(...responses: TurnResult[]) {
  const seen: Anthropic.Beta.BetaMessageParam[][] = [];
  const turn: Turn = async (request, onText) => {
    seen.push(structuredClone(request.messages));
    const next = responses.shift();
    if (!next) throw new Error('script ran out');
    for (const block of next.content) if (block.type === 'text') onText(block.text);
    return next;
  };
  return { turn, seen };
}

const source = {
  read: (path: string) => `${path}, lines 1–1 of 1\n1\tcontent`,
  search: async () => 'No matches.',
} as unknown as SourceAccess;

function run(turn: Turn) {
  const events: ChatEvent[] = [];
  return { events, deps: { turn, source, emit: (e: ChatEvent) => events.push(e) } };
}

describe('advance', () => {
  it('streams a plain answer and sends the page context with the question', async () => {
    const { turn, seen } = scripted(text('Hello!'));
    const conversation = new Conversations().get(undefined);
    const { events, deps } = run(turn);
    await advance(conversation, { type: 'text', text: 'hi', page }, deps);
    expect(events).toEqual([{ type: 'text', delta: 'Hello!' }, { type: 'done' }]);
    const first = seen[0]![0]!.content as Array<{ type: string; text: string }>;
    expect(first[0]!.text).toContain('"viewport":"1280×800 @1x"');
    expect(first[1]!.text).toBe('hi');
  });

  it('runs server tools itself and feeds the results back', async () => {
    const { turn, seen } = scripted(
      { content: [use('t1', 'read_file', { path: 'src/App.tsx' })], stop_reason: 'tool_use' },
      text('Found it.'),
    );
    const { events, deps } = run(turn);
    await advance(new Conversations().get(undefined), { type: 'text', text: 'why?', page }, deps);
    expect(events).toContainEqual({ type: 'activity', label: 'Reading src/App.tsx' });
    expect(seen[1]!.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: 'src/App.tsx, lines 1–1 of 1\n1\tcontent',
        },
      ],
    });
  });

  it('hands client tools to the browser, then answers every call of the turn in one message', async () => {
    const { turn, seen } = scripted(
      {
        content: [
          use('a', 'search_code', { pattern: 'x' }),
          use('b', 'point_at_element', { prompt: 'Click it.' }),
        ],
        stop_reason: 'tool_use',
      },
      text('Thanks.'),
    );
    const conversation = new Conversations().get(undefined);
    const first = run(turn);
    await advance(conversation, { type: 'text', text: 'look', page }, first.deps);
    expect(first.events.at(-1)).toEqual({
      type: 'client_tools',
      calls: [{ id: 'b', name: 'point_at_element', input: { prompt: 'Click it.' } }],
    });

    const second = run(turn);
    await advance(
      conversation,
      { type: 'tool_results', results: [{ id: 'b', content: '{"tag":"button"}' }] },
      second.deps,
    );
    expect(seen[1]!.at(-1)!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'No matches.' },
      { type: 'tool_result', tool_use_id: 'b', content: '{"tag":"button"}' },
    ]);
    expect(second.events.at(-1)).toEqual({ type: 'done' });
  });

  it('answers a pending call for the user when they type something new instead', async () => {
    const { turn, seen } = scripted(
      { content: [use('p', 'propose_issue', { title: 'T', body: 'B' })], stop_reason: 'tool_use' },
      text('Sure.'),
    );
    const conversation = new Conversations().get(undefined);
    await advance(conversation, { type: 'text', text: 'report it', page }, run(turn).deps);
    await advance(conversation, { type: 'text', text: 'actually, wait', page }, run(turn).deps);
    const content = seen[1]!.at(-1)!.content as Array<{ type: string }>;
    expect(content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'p',
      content: 'No answer: the user wrote a new message instead.',
    });
    expect(content.map((b) => b.type)).toEqual(['tool_result', 'text', 'text']);
  });

  it('turns invalid client tool input into an error result instead of asking the browser', async () => {
    const { turn, seen } = scripted(
      { content: [use('q', 'propose_issue', { title: '' })], stop_reason: 'tool_use' },
      text('Let me try that again.'),
    );
    const { events, deps } = run(turn);
    await advance(
      new Conversations().get(undefined),
      { type: 'text', text: 'file it', page },
      deps,
    );
    expect(events.some((e) => e.type === 'client_tools')).toBe(false);
    expect(seen[1]!.at(-1)!.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'q',
        content: 'title must be a non-empty string.',
        is_error: true,
      },
    ]);
  });

  it('never runs a tool call that was cut off at max_tokens', async () => {
    const { turn, seen } = scripted(
      { content: [use('m', 'read_file', { path: 'src/Ap' })], stop_reason: 'max_tokens' },
      text('Sorry, again.'),
    );
    const { events, deps } = run(turn);
    await advance(new Conversations().get(undefined), { type: 'text', text: 'read', page }, deps);
    expect(events.some((e) => e.type === 'activity')).toBe(false);
    expect(seen[1]!.at(-1)!.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'm',
        content: 'The call was cut off before its input was complete.',
        is_error: true,
      },
    ]);
  });

  it('reports a failed model call in the chat', async () => {
    const turn: Turn = async () => {
      throw new Error('boom');
    };
    const { events, deps } = run(turn);
    await advance(new Conversations().get(undefined), { type: 'text', text: 'hi', page }, deps);
    expect(events).toEqual([
      { type: 'error', message: 'Something went wrong talking to the model: boom' },
    ]);
  });
});
