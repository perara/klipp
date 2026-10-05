import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
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

  it('never starts the agent for a run already stopped', async () => {
    const events: AgentEvent[] = [];
    const stopped = new AbortController();
    stopped.abort();
    await runner.run(
      { agent: 'claude', system: 'S', message: ask('who are you'), tools: [TOOL] },
      {
        onEvent: (event) => events.push(event),
        onTool: () => Promise.reject(new Error('none')),
        signal: stopped.signal,
      },
    );
    // The fake agent's first event is `session`: any event at all means it was started.
    expect(events).toEqual([]);
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

  it('checks a sandbox that failed again, at most every 30 s; one that works stays checked', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_FAKE_SANDBOX: 'broken' };
    const codex = localRunner({ root: process.cwd(), bridge, env, commands: { codex: fakeAgent } });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const broken = /Codex's sandbox can't run/;
      expect(await codex.problem('codex')).toMatch(broken);
      delete env.CODEX_FAKE_SANDBOX; // such as the AppArmor profile, loaded now
      expect(await codex.problem('codex')).toMatch(broken);
      vi.setSystemTime(Date.now() + 30_000);
      expect(await codex.problem('codex')).toBeUndefined();
      env.CODEX_FAKE_SANDBOX = 'broken';
      vi.setSystemTime(Date.now() + 60_000);
      expect(await codex.problem('codex')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
