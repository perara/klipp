import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBox, type BoxServer } from '../box/server.js';
import type { AgentEvent } from './agents.js';
import { boxRunner, ndjsonLines } from './box-client.js';
import { createKlippMiddleware } from './handler.js';
import type { McpResult } from './mcp.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
const TOKEN = 'klipp-token-0123456789';
let box: BoxServer;
const stubs: Server[] = [];

beforeAll(async () => {
  const data = mkdtempSync(join(tmpdir(), 'klipp-box-client-'));
  for (const sub of ['claude', 'codex']) {
    mkdirSync(join(data, sub), { recursive: true });
    writeFileSync(join(data, sub, 'fake-signed-in'), '');
  }
  box = await startBox({
    root: process.cwd(),
    data,
    port: 0,
    tokens: `klipp=${TOKEN}`,
    commands: { claude: fakeAgent, codex: fakeAgent },
  });
});
afterAll(async () => {
  await box.close();
  for (const s of stubs) s.close();
});

/** A stand-in box that answers every request the same way. */
async function stub(answer: (res: ServerResponse, req: IncomingMessage) => void) {
  const server = createServer((req, res) => answer(res, req));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  stubs.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * A stand-in box that streams `lines` and holds the stream open. `closed` settles when the
 * client lets go of it, `answers` collects the tool answers it is sent (a 2xx one ends the run).
 */
async function holdingBox(lines: string, toolStatus = 204) {
  const answers: Array<{ url: string; body: string }> = [];
  let held: ServerResponse | undefined;
  let release = () => {};
  const closed = new Promise<void>((done) => (release = done));
  const url = await stub((res, req) => {
    if (!req.url?.includes('/tools/')) {
      held = res;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(lines);
      res.on('close', release);
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      answers.push({ url: req.url!, body });
      res.statusCode = toolStatus;
      res.end();
      if (toolStatus < 300) held?.end('{"type":"done"}\n');
    });
  });
  return { url, answers, closed };
}

const TOOL_CALL = '{"type":"run","id":"r"}\n{"type":"tool_call","id":"c","name":"p","input":{}}\n';
const LOST = { type: 'error', message: 'Lost the AI box mid-answer.' };

const ask = (question: string) => `<page_context>\n{}\n</page_context>\n\n${question}`;
async function run(
  url: string,
  question: string,
  onTool: (name: string) => Promise<McpResult> = () => Promise.resolve({ text: 'not now' }),
  token = TOKEN,
  signal = new AbortController().signal,
) {
  const events: AgentEvent[] = [];
  await boxRunner({ url, token }).run(
    {
      agent: 'claude',
      system: 'S',
      message: ask(question),
      tools: [{ name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } }],
    },
    { onEvent: (e) => events.push(e), onTool, signal },
  );
  return events;
}
const textOf = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

describe('boxRunner', () => {
  it('runs a turn in the box and answers its tool calls', async () => {
    expect(textOf(await run(box.url, 'who are you'))).toBe('I am Claude, in a paperclip.');
    const tools: string[] = [];
    const events = await run(box.url, 'the button is broken', (name) => {
      tools.push(name);
      return Promise.resolve({ text: 'not now' });
    });
    expect(tools).toEqual(['point_at_element']);
    expect(textOf(events)).toBe('No problem.');
  });

  it('says when the box is down, refuses the token, or is busy', async () => {
    const down = boxRunner({ url: 'http://127.0.0.1:9', token: TOKEN });
    expect(await down.problem('claude')).toBe("The AI box at http://127.0.0.1:9 isn't answering.");
    expect(
      await boxRunner({ url: box.url, token: 'wrong-wrong-wrong-wrong' }).problem('claude'),
    ).toBe("The AI box refused Klipp's token.");
    const busy = await stub((res) => {
      res.statusCode = 429;
      res.end('{"error":"x"}');
    });
    expect((await run(busy, 'hi')).at(-1)).toEqual({
      type: 'error',
      message: 'The AI box is busy; try again shortly.',
    });
  });

  it('lets go of a refusal it doesn’t read', async () => {
    for (const status of [401, 429]) {
      let hungUp = () => {};
      const gone = new Promise<void>((done) => (hungUp = done));
      // A body that never ends: only the client letting go of it closes the connection.
      const url = await stub((res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.write('{"error":');
        res.on('close', hungUp);
      });
      expect(await boxRunner({ url, token: TOKEN }).problem('claude')).toMatch(/^The AI box /);
      await gone;
    }
  });

  it('says so when the box goes away mid-answer', async () => {
    const cut = await stub((res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write('{"type":"run","id":"r"}\n{"type":"text","delta":"Hel');
      setTimeout(() => res.destroy(), 50);
    });
    expect((await run(cut, 'hi')).at(-1)).toEqual({
      type: 'error',
      message: 'Lost the AI box mid-answer.',
    });
  });

  it('stops when the caller aborts: the box is let go, a late tool answer is not sent', async () => {
    const held = await holdingBox(TOOL_CALL);
    const abort = new AbortController();
    let answer = (_: McpResult) => {};
    let asked = () => {};
    const toolAsked = new Promise<void>((done) => (asked = done));
    const running = run(
      held.url,
      'hi',
      () => {
        asked();
        return new Promise<McpResult>((done) => (answer = done));
      },
      TOKEN,
      abort.signal,
    );
    await toolAsked;
    abort.abort();
    expect(await running).toEqual([]);
    await held.closed;
    answer({ text: 'too late' });
    await new Promise((done) => setTimeout(done, 100));
    expect(held.answers).toEqual([]);
  });

  it('says so, and lets the box go, when a tool answer cannot be delivered', async () => {
    const held = await holdingBox(TOOL_CALL, 500);
    expect(await run(held.url, 'hi')).toEqual([LOST]);
    await held.closed;
  });

  it('tells the box when a tool fails', async () => {
    const held = await holdingBox(TOOL_CALL);
    const events = await run(held.url, 'hi', () => Promise.reject(new Error('The page is gone.')));
    expect(events).toEqual([{ type: 'done' }]);
    expect(held.answers.map((a) => JSON.parse(a.body) as unknown)).toEqual([
      { content: 'The page is gone.', isError: true },
    ]);
  });

  it('says so, and lets the box go, when a line is not JSON', async () => {
    const held = await holdingBox('{"type":"run","id":"r"}\nnot json\n');
    expect(await run(held.url, 'hi')).toEqual([LOST]);
    await held.closed;
  });

  it('stops reading after the box says done', async () => {
    const held = await holdingBox(
      '{"type":"run","id":"r"}\n{"type":"done"}\n{"type":"text","delta":"x"}\n',
    );
    expect(await run(held.url, 'hi')).toEqual([{ type: 'done' }]);
    await held.closed;
  });

  it('needs a token before it asks the box anything', async () => {
    const calls: unknown[] = [];
    const fetchSpy = ((...args: unknown[]) => calls.push(args)) as unknown as typeof fetch;
    const runner = boxRunner({ url: box.url, token: '' }, fetchSpy);
    const message = 'Klipp has no token for the AI box: set KLIPP_BOX_TOKEN.';
    expect(await runner.problem('claude')).toBe(message);
    const events: AgentEvent[] = [];
    await runner.run(
      { agent: 'claude', system: 'S', message: 'M', tools: [] },
      {
        onEvent: (e) => events.push(e),
        onTool: () => Promise.resolve({ text: '' }),
        signal: new AbortController().signal,
      },
    );
    expect(events).toEqual([{ type: 'error', message }]);
    expect(calls).toEqual([]);
  });

  it('says so when the box answers with something other than its agents', async () => {
    for (const body of ['<html>', '{}', '{"agents":[null]}']) {
      const url = await stub((res) => res.end(body));
      expect(await boxRunner({ url, token: TOKEN }).problem('claude')).toBe(
        `The AI box at ${url} answered unexpectedly.`,
      );
    }
  });

  it('reads lines split across chunks, multibyte characters too', async () => {
    const bytes = new TextEncoder().encode('{"a":"blåbær 📎"}\n\n{"b":1}\n');
    const cuts = [3, 11, 12, 18, bytes.length];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let from = 0;
        for (const to of cuts) {
          controller.enqueue(bytes.slice(from, to));
          from = to;
        }
        controller.close();
      },
    });
    const seen: string[] = [];
    for await (const line of ndjsonLines(body)) seen.push(line);
    expect(seen).toEqual(['{"a":"blåbær 📎"}', '', '{"b":1}']);
  });
});

describe('Klipp with a box', () => {
  it('lists the box’s agents and answers the chat through it', async () => {
    const middleware = createKlippMiddleware({
      root: process.cwd(),
      box: { url: box.url, token: TOKEN },
    });
    const server = createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    stubs.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const agents = (await (
      await fetch(`${base}/@klipp/agents`, { headers: { 'X-Klipp': '1' } })
    ).json()) as {
      agents: Array<{ id: string; available: boolean }>;
    };
    expect(agents.agents.every((a) => a.available)).toBe(true);
    const page = {
      url: 'x',
      viewport: 'x',
      colorScheme: 'light',
      userAgent: 'x',
      recentErrors: [],
      failedRequests: [],
    };
    const chat = await fetch(`${base}/@klipp/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Klipp': '1' },
      body: JSON.stringify({ agent: 'claude', text: 'who are you', page }),
    });
    // The answer streams word by word, one SSE line each.
    expect(await chat.text()).toContain('"delta":"paperclip."');
    middleware.close();
  });
});

it.each(['claude', 'codex'] as const)(
  'relays approved screenshots as MCP images to %s in the box',
  async (agent) => {
    const events: AgentEvent[] = [];
    const image = { mimeType: 'image/jpeg' as const, data: '/9j/2Q==', width: 1, height: 1 };
    await boxRunner({ url: box.url, token: TOKEN }).run(
      {
        agent,
        system: 'S',
        message: ask('screenshot'),
        tools: [
          {
            name: 'take_screenshot',
            description: 'Screenshot after consent.',
            inputSchema: { type: 'object' },
          },
        ],
      },
      {
        signal: new AbortController().signal,
        onEvent: (e) => events.push(e),
        onTool: (name) => {
          expect(name).toBe('take_screenshot');
          return Promise.resolve({ text: 'Approved.', image });
        },
      },
    );
    expect(textOf(events)).toContain('Image received: image/jpeg');
  },
);
