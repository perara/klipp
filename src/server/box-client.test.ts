import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
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
async function stub(answer: (res: ServerResponse) => void) {
  const server = createServer((_req, res) => answer(res));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  stubs.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ask = (question: string) => `<page_context>\n{}\n</page_context>\n\n${question}`;
async function run(
  url: string,
  question: string,
  onTool: (name: string) => Promise<McpResult> = () => Promise.resolve({ text: 'not now' }),
  token = TOKEN,
) {
  const events: AgentEvent[] = [];
  await boxRunner({ url, token }).run(
    {
      agent: 'claude',
      system: 'S',
      message: ask(question),
      tools: [{ name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } }],
    },
    { onEvent: (e) => events.push(e), onTool, signal: new AbortController().signal },
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
