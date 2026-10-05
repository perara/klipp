import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent } from './agents.js';
import { McpBridge } from './mcp.js';
import { localRunner } from './runner.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
const bridge = new McpBridge('0');
afterAll(() => bridge.close());
const runner = localRunner({
  root: process.cwd(),
  bridge,
  commands: { claude: fakeAgent, codex: ['no-such-codex-binary'] },
});
const ask = (question: string) => `<page_context>\n{}\n</page_context>\n\n${question}`;
const TOOL = { name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } };

async function run(question: string, onTool = () => Promise.resolve({ text: 'not now' })) {
  const events: AgentEvent[] = [];
  const tools: string[] = [];
  await runner.run(
    { agent: 'claude', system: 'S', message: ask(question), tools: [TOOL] },
    {
      onEvent: (event) => events.push(event),
      onTool: (name) => (tools.push(name), onTool()),
      signal: new AbortController().signal,
    },
  );
  return { events, tools };
}

describe('localRunner', () => {
  it('runs one turn, streaming the session, the text and the end', async () => {
    const { events } = await run('who are you');
    expect(events[0]).toMatchObject({ type: 'session' });
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('I am Claude, in a paperclip.');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('hands calls to the run’s tools to the caller', async () => {
    const { events, tools } = await run('the button is broken');
    expect(tools).toEqual(['point_at_element']);
    expect(events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('')).toBe(
      'No problem.',
    );
  });

  it('says why when the agent stops without finishing', async () => {
    const broken = localRunner({
      root: process.cwd(),
      bridge,
      commands: { claude: ['/no/such/claude'] },
    });
    const events: AgentEvent[] = [];
    await broken.run(
      { agent: 'claude', system: 'S', message: ask('hi'), tools: [] },
      {
        onEvent: (e) => events.push(e),
        onTool: () => Promise.reject(new Error('none')),
        signal: new AbortController().signal,
      },
    );
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/^Claude stopped/),
    });
  });

  it('reports a missing CLI as the agent’s problem', async () => {
    expect(await runner.problem('codex')).toMatch(/can't find `codex`/);
    expect(await runner.problem('claude')).toBeUndefined();
  });
});
