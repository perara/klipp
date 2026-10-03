import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatEvent, IssueDraft, PageContext } from '../shared/protocol.js';
import type { KlippLogEntry } from './handler.js';
import { optionsFromEnv } from './env.js';
import { serve, type KlippServer } from './serve.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];
const page: PageContext = {
  url: 'x',
  viewport: 'x',
  colorScheme: 'light',
  userAgent: 'x',
  recentErrors: [],
  failedRequests: [],
};
const filed: Array<IssueDraft & { labels: string[] }> = [];
const logged: KlippLogEntry[] = [];
let server: KlippServer;

beforeAll(async () => {
  server = await serve({
    port: 0,
    host: '127.0.0.1',
    root: process.cwd(),
    commands: { claude: fakeAgent, codex: fakeAgent },
    identity: { header: 'x-klipp-user', messagesPerHour: 4 },
    fileIssue: (draft, labels) => {
      filed.push({ ...draft, labels });
      return Promise.resolve('https://github.com/acme/app/issues/9');
    },
    log: (entry) => logged.push(entry),
  });
});
afterAll(() => server.close());

/** A request as the sign-in proxy forwards it: the public host, and who the user is. */
function send(path: string, user: string | undefined, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Klipp': '1',
    Host: 'square.example.org',
    Origin: 'https://square.example.org',
    'X-Forwarded-For': '203.0.113.7',
    ...(user ? { 'X-Klipp-User': user } : {}),
  };
  return new Promise<{ status: number; text: string }>((done, fail) => {
    const req = request(
      `${server.url}${path}`,
      { method: body === undefined ? 'GET' : 'POST', headers },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => done({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const events = (text: string) =>
  text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ChatEvent);

describe('serve, behind a sign-in proxy', () => {
  it('answers its health check, and anyone the proxy names, from anywhere', async () => {
    expect(await send('/healthz', undefined)).toEqual({ status: 200, text: 'ok' });
    expect((await send('/@klipp/agents', undefined)).status).toBe(401);
    expect((await send('/@klipp/agents', 'kari@example.no')).status).toBe(200);
    expect((await send('/elsewhere', 'kari@example.no')).status).toBe(404);
  });

  it("keeps each user's conversation to them", async () => {
    const first = events(
      (await send('/@klipp/chat', 'kari@example.no', { agent: 'claude', text: 'hi', page })).text,
    );
    const id = (first[0] as { id: string }).id;
    const other = events(
      (
        await send('/@klipp/chat', 'ola@example.no', {
          agent: 'claude',
          conversation: id,
          text: 'what did I say?',
          page,
        })
      ).text,
    );
    expect((other[0] as { id: string }).id).not.toBe(id);
    const result = { conversation: id, id: 'x', content: 'y' };
    expect((await send('/@klipp/tool-result', 'ola@example.no', result)).status).toBe(404);
  });

  it('files a ticket saying who reported it, and logs turns without what was said', async () => {
    filed.length = 0;
    // Reads the stream and, like the browser, files the proposed ticket and answers the card.
    await new Promise<void>((done, fail) => {
      const req = request(
        `${server.url}/@klipp/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Klipp': '1',
            Host: 'square.example.org',
            Origin: 'https://square.example.org',
            'X-Klipp-User': 'per@example.no',
          },
        },
        (res) => {
          let buffer = '';
          let conversation = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
              const event = JSON.parse(buffer.slice(6, end)) as ChatEvent;
              buffer = buffer.slice(end + 2);
              if (event.type === 'conversation') conversation = event.id;
              if (event.type !== 'client_tool') continue;
              const proposal = event.call.id;
              void send('/@klipp/issue', 'per@example.no', {
                conversation,
                proposal,
                footer: '---',
              })
                .then(() =>
                  send('/@klipp/tool-result', 'per@example.no', {
                    conversation,
                    id: proposal,
                    content: 'Filed: https://github.com/acme/app/issues/9',
                  }),
                )
                .catch(fail);
            }
          });
          res.on('end', () => done());
        },
      );
      req.on('error', fail);
      req.end(JSON.stringify({ agent: 'claude', text: 'report it', page }));
    });
    expect(filed).toHaveLength(1);
    expect(filed[0]!.body.endsWith('---\n\nReported by per@example.no.')).toBe(true);
    expect(logged).toContainEqual({
      event: 'filed',
      user: 'per@example.no',
      url: 'https://github.com/acme/app/issues/9',
    });
    expect(logged).toContainEqual(
      expect.objectContaining({ event: 'turn', user: 'per@example.no', outcome: 'answered' }),
    );
    expect(JSON.stringify(logged)).not.toContain('report it');
  });

  it("limits each user's messages per hour", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await send('/@klipp/chat', 'busy@example.no', { agent: 'claude', text: 'hi', page }))
          .status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
    expect(logged).toContainEqual({ event: 'limited', user: 'busy@example.no' });
  });
});

describe('serve, on its own', () => {
  it('listens beyond this machine only behind a sign-in proxy', async () => {
    await expect(serve({ port: 0, host: '0.0.0.0', root: process.cwd() })).rejects.toThrow(
      /only behind a sign-in proxy/,
    );
  });
});

describe('optionsFromEnv', () => {
  it('reads its settings from the environment', () => {
    const options = optionsFromEnv(
      {
        KLIPP_PORT: '9000',
        KLIPP_HOST: '0.0.0.0',
        KLIPP_AGENT: 'codex',
        KLIPP_REPO: 'https://github.com/acme/app',
        KLIPP_IDENTITY_HEADER: 'X-Klipp-User',
        KLIPP_ALLOW: 'kari@example.no, ola@example.no',
        KLIPP_MESSAGES_PER_HOUR: '10',
        KLIPP_PASS_ENV: 'NO_PROXY',
      },
      '/repo',
    );
    expect(options).toMatchObject({
      root: '/repo',
      port: 9000,
      host: '0.0.0.0',
      agent: 'codex',
      repo: 'https://github.com/acme/app',
      maxRuns: 4,
      passEnv: ['NO_PROXY'],
      identity: {
        header: 'X-Klipp-User',
        allow: ['kari@example.no', 'ola@example.no'],
        messagesPerHour: 10,
      },
    });
    expect(
      optionsFromEnv({ KLIPP_IDENTITY_HEADER: 'x', KLIPP_ALLOW: '*' }, '/r').identity?.allow,
    ).toBe('*');
  });

  it('refuses settings it cannot use', () => {
    expect(() => optionsFromEnv({ KLIPP_AGENT: 'gpt' }, '/r')).toThrow(/KLIPP_AGENT/);
    expect(() => optionsFromEnv({ KLIPP_PORT: 'eighty' }, '/r')).toThrow(/KLIPP_PORT/);
  });
});
