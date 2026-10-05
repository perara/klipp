import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startBox, type BoxServer } from './server.js';
import { createUiApi, type UiDeps } from './ui-api.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
const TOKEN = 'klipp-token-0123456789';
let box: BoxServer;
beforeAll(async () => {
  const data = mkdtempSync(join(tmpdir(), 'klipp-box-ui-'));
  mkdirSync(join(data, 'codex'), { recursive: true });
  writeFileSync(join(data, 'codex', 'fake-signed-in'), '');
  box = await startBox({
    root: process.cwd(),
    data,
    port: 0,
    tokens: `klipp=${TOKEN}`,
    commands: { claude: fakeAgent, codex: fakeAgent },
    keepAliveMs: 50,
  });
});
afterAll(() => box.close());

const ui = { 'X-Klipp': '1', 'Content-Type': 'application/json' };
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = ui) =>
  fetch(`${box.url}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A request by another name than localhost, which fetch won't send. */
const asHost = (host: string, path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((done, fail) => {
    const req = request(`${box.url}${path}`, { headers: { Host: host, ...headers } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });

/** A stream's raw text, read until it holds `needle` (or ends), then closed from this side. */
async function readUntil(response: Response, needle: string): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes(needle)) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return text;
}

/** An SSE stream's messages as parsed JSON, until it ends or the caller stops reading. */
async function* messages<T>(path: string): AsyncGenerator<T> {
  const response = await fetch(`${box.url}${path}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
        // A line starting with a colon is a keep-alive comment, not a message.
        if (!buffer.startsWith(':')) yield JSON.parse(buffer.slice(6, at)) as T;
        buffer = buffer.slice(at + 2);
      }
    }
  } finally {
    await reader.cancel();
  }
}

/** The first SSE messages of a stream. */
async function events<T>(path: string, count: number): Promise<T[]> {
  const seen: T[] = [];
  for await (const message of messages<T>(path)) if (seen.push(message) >= count) break;
  return seen;
}

describe('the box UI API', () => {
  it('answers only at localhost, and changes only with Klipp’s header from the same origin', async () => {
    expect(await asHost('evil.example', '/ui/api/agents')).toBe(403);
    expect(await asHost('evil.example', '/')).toBe(403);
    expect(await asHost('localhost:1234', '/ui/api/agents')).toBe(200);
    expect(
      (await call('POST', '/ui/api/tokens', { name: 'x' }, { 'Content-Type': 'application/json' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/ui/api/tokens',
          { name: 'x' },
          { ...ui, Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
  });

  it('shows each agent’s version and sign-in', async () => {
    const agents = (await (await call('GET', '/ui/api/agents')).json()) as Array<{
      id: string;
      signedIn: boolean;
      version: string;
    }>;
    expect(agents.map((a) => [a.id, a.signedIn, a.version])).toEqual([
      ['claude', false, '9.9.9 (fake)'],
      ['codex', true, '9.9.9 (fake)'],
    ]);
  });

  it('signs Claude in through the page', async () => {
    const { login } = (await (await call('POST', '/ui/api/agents/claude/login')).json()) as {
      login: string;
    };
    // The stream starts with where the sign-in is, then follows it to the link and the prompt.
    let waiting: { state: string; url?: string; needsCode?: boolean } | undefined;
    for await (const state of messages<NonNullable<typeof waiting>>(`/ui/api/logins/${login}`)) {
      if (state.state === 'waiting') {
        waiting = state;
        break;
      }
    }
    expect(waiting).toMatchObject({ url: expect.stringContaining('https://'), needsCode: true });
    expect((await call('POST', `/ui/api/logins/${login}/code`, { code: 'good-code' })).status).toBe(
      200,
    );
    for (let i = 0; i < 50; i++) {
      const agents = (await (await call('GET', '/ui/api/agents')).json()) as Array<{
        id: string;
        signedIn: boolean;
      }>;
      if (agents[0]!.signedIn) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Claude never signed in');
  });

  it('ends a sign-in’s stream when the sign-in is done, and when it is cancelled', async () => {
    const start = async (agent: string) =>
      ((await (await call('POST', `/ui/api/agents/${agent}/login`)).json()) as { login: string })
        .login;
    const codex = await start('codex');
    const states = (await events<{ state: string }>(`/ui/api/logins/${codex}`, 99)).map(
      (s) => s.state,
    );
    expect(states.at(-1)).toBe('done');

    const claude = await start('claude');
    let last: { state: string; message?: string } | undefined;
    for await (const login of messages<NonNullable<typeof last>>(`/ui/api/logins/${claude}`)) {
      last = login;
      if (login.state === 'waiting')
        expect((await call('DELETE', `/ui/api/logins/${claude}`)).status).toBe(204);
    }
    expect(last).toMatchObject({ state: 'failed', message: 'Cancelled.' });
    expect((await call('GET', '/ui/api/logins/nope')).status).toBe(404);
    expect((await call('POST', '/ui/api/logins/nope/code', { code: 'x' })).status).toBe(404);
  });

  it('answers localhost, 127.0.0.1 and [::1] on any port, and no other name, not even x.localhost', async () => {
    for (const host of ['localhost:1234', '127.0.0.1:1234', '[::1]:1234', 'LOCALHOST']) {
      expect(await asHost(host, '/ui/api/agents')).toBe(200);
    }
    for (const host of ['x.localhost:1234', 'localhost.evil.example', '10.0.0.5:1234', '[::2]']) {
      expect(await asHost(host, '/ui/api/agents')).toBe(403);
      expect(await asHost(host, '/')).toBe(403);
    }
  });

  it('keeps the Host check for every /ui/ path, and leaves /v1 to its tokens', async () => {
    expect(await asHost('evil.example', '/ui/anything')).toBe(403);
    expect(await asHost('localhost', '/ui/anything')).toBe(404);
    const auth = { Authorization: `Bearer ${TOKEN}` };
    expect(await asHost('evil.example', '/v1/agents', auth)).toBe(200);
    expect(await asHost('evil.example', '/v1/agents')).toBe(401);
  });

  it('refuses anything from another site, whatever the method', async () => {
    const get = (site: string, path = '/ui/api/agents') =>
      call('GET', path, undefined, { 'Sec-Fetch-Site': site });
    expect((await get('cross-site')).status).toBe(403);
    expect((await get('same-site')).status).toBe(403);
    expect((await get('cross-site', '/ui/api/logins/any')).status).toBe(403);
    expect((await get('same-origin')).status).toBe(200);
    // Klipp's header is not enough from another site, with or without an Origin to tell.
    const post = { ...ui, 'Sec-Fetch-Site': 'cross-site' };
    expect((await call('POST', '/ui/api/tokens', { name: 'x' }, post)).status).toBe(403);
    // A change without Klipp's header is refused; with it, this token would be 404 (from the environment).
    expect((await call('DELETE', '/ui/api/tokens/klipp', undefined, {})).status).toBe(403);
    expect((await call('DELETE', '/ui/api/tokens/klipp')).status).toBe(404);
  });

  it('sends a keep-alive comment on a sign-in stream that has nothing to say', async () => {
    const { login } = (await (await call('POST', '/ui/api/agents/claude/login')).json()) as {
      login: string;
    };
    const text = await readUntil(
      await fetch(`${box.url}/ui/api/logins/${login}`),
      ': keep-alive\n\n',
    );
    expect(text).toContain('\n\n: keep-alive\n\n');
    expect((await call('DELETE', `/ui/api/logins/${login}`)).status).toBe(204);
  });

  it('makes, lists and revokes tokens', async () => {
    const { token } = (await (
      await call('POST', '/ui/api/tokens', { name: 'square-dev' })
    ).json()) as { token: string };
    expect(
      (await fetch(`${box.url}/v1/agents`, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(200);
    const list = (await (await call('GET', '/ui/api/tokens')).json()) as Array<{ name: string }>;
    expect(list.map((t) => t.name)).toEqual(['klipp', 'square-dev']);
    expect(JSON.stringify(list)).not.toContain(token);
    expect((await call('DELETE', '/ui/api/tokens/square-dev')).status).toBe(204);
    expect((await call('DELETE', '/ui/api/tokens/klipp')).status).toBe(404);
    expect((await call('POST', '/ui/api/tokens', { name: 'bad name' })).status).toBe(400);
    expect((await call('POST', '/ui/api/tokens', { name: 5 })).status).toBe(400);
  });

  it('answers a path that isn’t valid percent-encoding with 400, and keeps answering', async () => {
    expect((await call('DELETE', '/ui/api/tokens/%E0%A4%A')).status).toBe(400);
    expect((await call('GET', '/ui/api/runs/%FF')).status).toBe(400);
    expect((await call('GET', '/ui/api/logins/%')).status).toBe(400);
    expect((await call('GET', '/ui/api/agents')).status).toBe(200);
  });

  it('lists runs and replays one', async () => {
    const run = await fetch(`${box.url}/v1/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'codex',
        system: 'S',
        message: '<page_context>\n{}\n</page_context>\n\nwho are you',
        tools: [],
      }),
    });
    await run.text();
    // The stream ends at `done`; the run is over once its CLI has exited, a moment later.
    const runs = await vi.waitFor(async () => {
      const list = (await (await call('GET', '/ui/api/runs')).json()) as Array<{
        id: string;
        app: string;
        outcome: string;
      }>;
      expect(list[0]).toMatchObject({ app: 'klipp', outcome: 'done' });
      return list;
    });
    const lines = await events<{ type: string }>(`/ui/api/runs/${runs[0]!.id}`, 99);
    expect(lines[0]!.type).toBe('head');
    expect(lines.at(-1)!.type).toBe('end');
    expect((await call('GET', '/ui/api/runs/nope')).status).toBe(404);
  });

  it('follows a run that is still going, and ends the stream when the run ends', async () => {
    const started = await fetch(`${box.url}/v1/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'codex',
        system: 'S',
        message: '<page_context>\n{}\n</page_context>\n\nthe button is broken',
        tools: [
          { name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } },
        ],
      }),
    });
    // The agent now waits for the page's answer to its tool call.
    const reader = started.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let run = '';
    let tool = '';
    while (!tool) {
      const { done, value } = await reader.read();
      if (done) throw new Error('The run ended before it called the tool.');
      const complete = (buffer + decoder.decode(value, { stream: true })).split('\n');
      buffer = complete.pop()!;
      for (const line of complete.filter(Boolean)) {
        const event = JSON.parse(line) as { type: string; id?: string };
        if (event.type === 'run') run = event.id!;
        if (event.type === 'tool_call') tool = event.id!;
      }
    }
    const seen: string[] = [];
    for await (const line of messages<{ type: string }>(`/ui/api/runs/${run}`)) {
      seen.push(line.type);
      // The replay is in and the page is following: let the agent go on to its end.
      if (line.type === 'tool_call') {
        const answer = await fetch(`${box.url}/v1/runs/${run}/tools/${tool}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'not now' }),
        });
        expect(answer.status).toBe(204);
      }
    }
    expect(seen[0]).toBe('head');
    expect(seen).toContain('tool_call');
    expect(seen.at(-1)).toBe('end');
    await reader.cancel();
  });
});

/** The UI API on a bare server, with a sign-in and a live run that never say anything more. */
async function quietApi(keepAliveMs?: number) {
  const stopped: string[] = [];
  const deps = {
    keepAliveMs,
    logins: {
      get: () => ({
        subscribe: (send: (state: unknown) => void) => {
          send({ state: 'starting' });
          return () => stopped.push('login');
        },
      }),
    },
    log: {
      read: () => [{ type: 'head' }],
      isLive: () => true,
      follow: () => () => stopped.push('run'),
    },
  } as unknown as UiDeps;
  const api = createUiApi(deps);
  const server = createServer((req, res) => void api.handle(req, res, req.url ?? ''));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    stopped,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
const STREAMS = [
  ['/ui/api/logins/any', 'login'],
  ['/ui/api/runs/any', 'run'],
] as const;

describe('the UI API when the page goes away', () => {
  it('stops listening to the sign-in and to the run', async () => {
    const quiet = await quietApi();
    try {
      for (const [path, what] of STREAMS) {
        await readUntil(await fetch(`${quiet.url}${path}`), 'data: ');
        await vi.waitFor(() => expect(quiet.stopped).toContain(what));
      }
    } finally {
      quiet.close();
    }
  });

  it('keeps both streams alive while they are quiet, and stops the timer when the page goes', async () => {
    const quiet = await quietApi(20);
    const set = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    try {
      for (const [path] of STREAMS) {
        const text = await readUntil(await fetch(`${quiet.url}${path}`), ': keep-alive\n\n');
        expect(text).toContain(': keep-alive\n\n');
      }
      await vi.waitFor(() => {
        const ours = set.mock.calls.flatMap((c, i) =>
          c[1] === 20 ? [set.mock.results[i]!.value as NodeJS.Timeout] : [],
        );
        expect(ours).toHaveLength(2);
        expect(cleared.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(ours));
      });
    } finally {
      set.mockRestore();
      cleared.mockRestore();
      quiet.close();
    }
  });
});
