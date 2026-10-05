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
const asHost = (host: string, path: string) =>
  new Promise<number>((done, fail) => {
    const req = request(`${box.url}${path}`, { headers: { Host: host } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });

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
        yield JSON.parse(buffer.slice(6, at)) as T;
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
    for await (const login of messages<{ state: string }>(`/ui/api/logins/${claude}`)) {
      if (login.state === 'waiting')
        expect((await call('DELETE', `/ui/api/logins/${claude}`)).status).toBe(204);
      if (login.state === 'failed') expect(login).toMatchObject({ message: 'Cancelled.' });
    }
    expect((await call('GET', '/ui/api/logins/nope')).status).toBe(404);
    expect((await call('POST', '/ui/api/logins/nope/code', { code: 'x' })).status).toBe(404);
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
    const runs = (await (await call('GET', '/ui/api/runs')).json()) as Array<{
      id: string;
      app: string;
      outcome: string;
    }>;
    expect(runs[0]).toMatchObject({ app: 'klipp', outcome: 'done' });
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

describe('the UI API when the page goes away', () => {
  it('stops listening to the sign-in and to the run', async () => {
    const stopped: string[] = [];
    const deps = {
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
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const [path, what] of [
        ['/ui/api/logins/any', 'login'],
        ['/ui/api/runs/any', 'run'],
      ] as const) {
        const response = await fetch(`${url}${path}`);
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        await vi.waitFor(() => expect(stopped).toContain(what));
      }
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
