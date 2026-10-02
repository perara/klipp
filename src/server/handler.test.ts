import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatEvent, ChatRequest, PageContext } from '../shared/protocol.js';
import { createKlippMiddleware } from './handler.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
let server: Server;
let base: string;
const filed: unknown[] = [];

beforeAll(async () => {
  const middleware = createKlippMiddleware({
    root: process.cwd(),
    manifest: () => ({ version: 1, entries: {} }),
    commands: { claude: fakeAgent, codex: ['no-such-codex-binary'] },
    labels: { bug: ['defect'] },
    fileIssue: async (draft, labels) => {
      filed.push({ ...draft, labels });
      return 'https://github.com/acme/app/issues/1';
    },
  });
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

const page: PageContext = {
  url: 'x',
  viewport: 'x',
  colorScheme: 'light',
  userAgent: 'x',
  recentErrors: [],
  failedRequests: [],
};
const headers = { 'Content-Type': 'application/json', 'X-Klipp': '1' };
const post = (path: string, body: unknown, extra: Record<string, string> = headers) =>
  fetch(`${base}${path}`, { method: 'POST', headers: extra, body: JSON.stringify(body) });

/** Reads the chat's event stream, answering page-tool calls with `answer`. */
async function chat(
  request: ChatRequest,
  answer?: (event: ChatEvent & { type: 'client_tool' }) => string,
) {
  const response = await post('/@klipp/chat', request);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const events: ChatEvent[] = [];
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let conversation = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const event = JSON.parse(buffer.slice(6, end)) as ChatEvent;
      buffer = buffer.slice(end + 2);
      events.push(event);
      if (event.type === 'conversation') conversation = event.id;
      if (event.type === 'client_tool' && answer) {
        await post('/@klipp/tool-result', {
          conversation,
          id: event.call.id,
          content: answer(event),
        });
      }
    }
  }
  return { events, conversation };
}

describe('createKlippMiddleware', () => {
  it('lists the agents it can run', async () => {
    const response = await fetch(`${base}/@klipp/agents`, { headers });
    expect(await response.json()).toEqual({
      agents: [
        { id: 'claude', label: 'Claude', available: true },
        { id: 'codex', label: 'Codex', available: false },
      ],
      preferred: 'claude',
    });
  });

  it('streams an answer from the agent running in the background', async () => {
    const { events } = await chat({ agent: 'claude', text: 'hi', page });
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('Hello! I am a test paperclip.');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('carries the conversation on across messages', async () => {
    const first = await chat({ agent: 'claude', text: 'remember the word pineapple', page });
    const second = await chat({
      agent: 'claude',
      conversation: first.conversation,
      text: 'what did I say?',
      page,
    });
    const text = second.events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('You said: remember the word pineapple');
    expect(second.conversation).toBe(first.conversation);
  });

  it("hands a ticket to the browser and gives the agent the browser's answer", async () => {
    const { events } = await chat(
      { agent: 'claude', text: 'report it', page },
      () => 'The user decided not to file it.',
    );
    const call = events.find((e) => e.type === 'client_tool');
    expect(call).toMatchObject({
      call: { name: 'propose_ticket', input: { type: 'bug', title: 'Count does nothing' } },
    });
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe("OK, I won't file it.");
  });

  it('sends an incomplete ticket back to the agent without showing it', async () => {
    const { events } = await chat({ agent: 'claude', text: 'an idea: dark mode', page });
    expect(events.some((e) => e.type === 'client_tool')).toBe(false);
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('What do you need it for? (missing for a feature request)');
  });

  it('reports an agent that is not installed, or that fails', async () => {
    const missing = await chat({ agent: 'codex', text: 'hi', page });
    expect(missing.events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining("can't find `codex`"),
    });
    const broken = await chat({ agent: 'claude', text: 'break it', page });
    expect(broken.events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('log in'),
    });
  });

  it('files issues', async () => {
    const response = await post('/sub/@klipp/issue', {
      title: 'Broken',
      body: 'It is.',
      type: 'bug',
    });
    expect(await response.json()).toEqual({ url: 'https://github.com/acme/app/issues/1' });
    await post('/@klipp/issue', { title: 'Idea', body: 'Yes.', type: 'feature' });
    expect(filed).toEqual([
      { title: 'Broken', body: 'It is.', type: 'bug', labels: ['defect'] },
      { title: 'Idea', body: 'Yes.', type: 'feature', labels: ['enhancement', 'klipp'] },
    ]);
  });

  it('refuses requests without its header or from another site', async () => {
    const request = { agent: 'claude', text: 'hi', page };
    expect(
      (await post('/@klipp/chat', request, { 'Content-Type': 'application/json' })).status,
    ).toBe(403);
    expect(
      (await post('/@klipp/chat', request, { ...headers, Origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect(
      (
        await post(
          '/@klipp/issue',
          { title: 'x', body: 'y' },
          { ...headers, 'Sec-Fetch-Site': 'cross-site' },
        )
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}/@klipp/agents`)).status).toBe(403);
    expect(filed).toHaveLength(2);
  });

  it('serves the manifest and leaves every other path alone', async () => {
    expect(await (await fetch(`${base}/@klipp/manifest.json`)).json()).toEqual({
      version: 1,
      entries: {},
    });
    expect((await fetch(`${base}/index.html`)).status).toBe(404);
    expect((await post('/@klipp/other', {})).status).toBe(404);
  });
});
