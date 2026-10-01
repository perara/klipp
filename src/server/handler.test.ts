import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatRequest } from '../shared/protocol.js';
import { createKlippMiddleware } from './handler.js';

let server: Server;
let base: string;
const filed: unknown[] = [];

beforeAll(async () => {
  const middleware = createKlippMiddleware({
    root: process.cwd(),
    manifest: () => ({ version: 1, entries: {} }),
    turn: async (_request, onText) => {
      onText('Hi there.');
      return {
        content: [{ type: 'text', text: 'Hi there.', citations: null }],
        stop_reason: 'end_turn',
      };
    },
    fileIssue: async (draft) => {
      filed.push(draft);
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

const request: ChatRequest = {
  input: {
    type: 'text',
    text: 'hi',
    page: {
      url: 'x',
      viewport: 'x',
      colorScheme: 'light',
      userAgent: 'x',
      recentErrors: [],
      failedRequests: [],
    },
  },
};
const post = (path: string, body: unknown, headers: Record<string, string> = { 'X-Klipp': '1' }) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('createKlippMiddleware', () => {
  it('streams the chat as server-sent events', async () => {
    const response = await post('/@klipp/chat', request);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const events = (await response.text())
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')));
    expect(events[0]).toMatchObject({ type: 'conversation' });
    expect(events.slice(1)).toEqual([{ type: 'text', delta: 'Hi there.' }, { type: 'done' }]);
  });

  it('files issues', async () => {
    const response = await post('/sub/@klipp/issue', { title: 'Broken', body: 'It is.' });
    expect(await response.json()).toEqual({ url: 'https://github.com/acme/app/issues/1' });
    expect(filed).toEqual([{ title: 'Broken', body: 'It is.' }]);
  });

  it('refuses requests without its header or from another site', async () => {
    expect((await post('/@klipp/chat', request, {})).status).toBe(403);
    expect(
      (await post('/@klipp/chat', request, { 'X-Klipp': '1', Origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect(
      (
        await post(
          '/@klipp/issue',
          { title: 'x', body: 'y' },
          { 'X-Klipp': '1', 'Sec-Fetch-Site': 'cross-site' },
        )
      ).status,
    ).toBe(403);
    expect(filed).toHaveLength(1);
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
