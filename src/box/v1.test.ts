import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBox, type BoxOptions, type BoxServer } from './server.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
const KLIPP = 'klipp-token-0123456789';
const OTHER = 'other-token-0123456789';
const boxes: BoxServer[] = [];

/** A data directory with both fake agents already signed in (the fake keeps a marker file). */
function data(): string {
  const dir = mkdtempSync(join(tmpdir(), 'klipp-box-'));
  for (const sub of ['claude', 'codex']) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, 'fake-signed-in'), '');
  }
  return dir;
}

async function box(extra: Partial<BoxOptions> = {}) {
  const started = await startBox({
    root: process.cwd(),
    data: data(),
    port: 0,
    tokens: `klipp=${KLIPP},other=${OTHER}`,
    commands: { claude: fakeAgent, codex: fakeAgent },
    keepAliveMs: 50,
    ...extra,
  });
  boxes.push(started);
  return started;
}
afterAll(async () => {
  for (const b of boxes) await b.close();
});

const ask = (question: string) => `<page_context>\n{}\n</page_context>\n\n${question}`;
const TOOLS = [
  { name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } },
];
const auth = (token = KLIPP) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});
const startRun = (
  b: BoxServer,
  body: Record<string, unknown>,
  token = KLIPP,
  signal?: AbortSignal,
) =>
  fetch(`${b.url}/v1/runs`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ agent: 'claude', system: 'S', tools: TOOLS, ...body }),
    ...(signal ? { signal } : {}),
  });

/** The stream's lines as they come; '' is a keep-alive. */
async function* lines(response: Response): AsyncGenerator<Record<string, unknown> | ''> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      yield line ? (JSON.parse(line) as Record<string, unknown>) : '';
    }
  }
}
async function all(response: Response) {
  const seen: Array<Record<string, unknown>> = [];
  for await (const line of lines(response)) if (line) seen.push(line);
  return seen;
}
const textOf = (events: Array<Record<string, unknown>>) =>
  events
    .filter((e) => e.type === 'text')
    .map((e) => e.delta)
    .join('');

let main: BoxServer;
beforeAll(async () => {
  main = await box();
});

describe('box protocol v1', () => {
  it('wants a known token', async () => {
    expect((await fetch(`${main.url}/v1/agents`)).status).toBe(401);
    expect(
      (await fetch(`${main.url}/v1/agents`, { headers: auth('nope-nope-nope-nope') })).status,
    ).toBe(401);
    expect((await startRun(main, { message: ask('hi') }, 'nope-nope-nope-nope')).status).toBe(401);
  });

  it('lists the agents and whether they can run', async () => {
    const body = (await (await fetch(`${main.url}/v1/agents`, { headers: auth() })).json()) as {
      agents: Array<{ id: string; available: boolean }>;
    };
    expect(body.agents.map((a) => [a.id, a.available])).toEqual([
      ['claude', true],
      ['codex', true],
    ]);
  });

  it('refuses requests outside the limits', async () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => ({
      name: `t${i}`,
      description: 'x',
      inputSchema: {},
    }));
    for (const body of [
      { agent: 'gpt', message: ask('hi') },
      { message: ask('hi'), system: 'x'.repeat(64 * 1024 + 1) },
      { message: 'x'.repeat(256 * 1024 + 1) },
      { message: ask('hi'), model: 'bad model' },
      { message: ask('hi'), tools: tooMany },
      { message: ask('hi'), tools: [{ name: 'Bad-Name', description: 'x', inputSchema: {} }] },
    ]) {
      expect((await startRun(main, body)).status).toBe(400);
    }
  });

  it('streams a run: its id first, then the agent’s events, then the end', async () => {
    const events = await all(await startRun(main, { message: ask('who are you') }));
    expect(events[0]).toMatchObject({ type: 'run' });
    expect(events[1]).toMatchObject({ type: 'session' });
    expect(textOf(events)).toBe('I am Claude, in a paperclip.');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('relays a tool call to the caller and the answer back, with keep-alives while it waits', async () => {
    const response = await startRun(main, { message: ask('the button is broken') });
    const events: Array<Record<string, unknown>> = [];
    let run = '';
    let blanksWhileWaiting = 0;
    let answered = false;
    for await (const line of lines(response)) {
      const call = events.find((e) => e.type === 'tool_call');
      if (line === '') {
        if (call) blanksWhileWaiting++;
      } else {
        events.push(line);
        if (line.type === 'run') run = String(line.id);
      }
      // Answer only after two keep-alives arrived while the call was waiting.
      if (call && !answered && blanksWhileWaiting >= 2) {
        answered = true;
        const other = await fetch(`${main.url}/v1/runs/${run}/tools/${String(call.id)}`, {
          method: 'POST',
          headers: auth(OTHER),
          body: JSON.stringify({ content: 'x' }),
        });
        expect(other.status).toBe(403);
        const ok = await fetch(`${main.url}/v1/runs/${run}/tools/${String(call.id)}`, {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({ content: 'not now' }),
        });
        expect(ok.status).toBe(204);
      }
    }
    expect(answered).toBe(true);
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({
      name: 'point_at_element',
      input: { prompt: 'Click the button you mean.' },
    });
    expect(textOf(events)).toBe('No problem.');
    const unknown = await fetch(`${main.url}/v1/runs/${run}/tools/nope`, {
      method: 'POST',
      headers: auth(),
      body: '{"content":"x"}',
    });
    expect(unknown.status).toBe(404);
  });

  it('closing the stream stops the run and frees its slot', async () => {
    const one = await box({ maxRuns: 1 });
    const stop = new AbortController();
    const response = await startRun(
      one,
      { message: ask('the button is broken') },
      KLIPP,
      stop.signal,
    );
    for await (const line of lines(response)) if (line && line.type === 'tool_call') break;
    expect((await startRun(one, { message: ask('hi') })).status).toBe(429);
    stop.abort();
    let status = 0;
    for (let i = 0; i < 50 && status !== 200; i++) {
      await new Promise((done) => setTimeout(done, 100));
      const next = await startRun(one, { message: ask('who are you') });
      status = next.status;
      if (status === 200) await all(next);
    }
    expect(status).toBe(200);
  });

  it('says why an agent can’t run', async () => {
    const noCodex = await box({ commands: { claude: fakeAgent, codex: ['no-such-codex-binary'] } });
    const refused = await startRun(noCodex, { agent: 'codex', message: ask('hi') });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/can't find `codex`/);
  });

  it('carries a session on only for the app that started it', async () => {
    const first = await all(await startRun(main, { message: ask('hello') }));
    const session = String(first.find((e) => e.type === 'session')!.id);
    const mine = await all(await startRun(main, { message: ask('what did i say'), session }));
    expect(mine.find((e) => e.type === 'session')!.id).toBe(session);
    const theirs = await all(
      await startRun(main, { message: ask('what did i say'), session }, OTHER),
    );
    expect(theirs.find((e) => e.type === 'session')!.id).not.toBe(session);
  });

  it('a restarted box still knows which app owns a session', async () => {
    const dir = data();
    const before = await box({ data: dir });
    const first = await all(await startRun(before, { message: ask('hello') }));
    const session = String(first.find((e) => e.type === 'session')!.id);
    await before.close();
    const after = await box({ data: dir });
    const again = await all(await startRun(after, { message: ask('what did i say'), session }));
    expect(again.find((e) => e.type === 'session')!.id).toBe(session);
    expect(textOf(again)).toBe('You said: hello');
  });
});
