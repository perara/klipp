import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpResult } from '../server/mcp.js';
import type { Runner } from '../server/runner.js';
import { RunLog } from './runlog.js';
import { startBox, type BoxOptions, type BoxServer } from './server.js';
import { Tokens } from './tokens.js';
import { createV1, type V1Deps } from './v1.js';

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

const forever = (signal: AbortSignal) =>
  new Promise<void>((done) =>
    signal.aborted ? done() : signal.addEventListener('abort', () => done()),
  );

/**
 * Protocol v1 on a bare HTTP server, with a runner (and, if wanted, an agent check) the test
 * controls. `gone` settles when the first response closes, so a test can wait for the box to
 * notice that a client left; `requests()` counts the requests the box has been handed.
 */
async function bare(runner: Partial<Runner>, deps: Partial<V1Deps> = {}) {
  const dir = data();
  const log = new RunLog(dir);
  const v1 = createV1({
    runner: { problem: () => Promise.resolve(undefined), run: () => Promise.resolve(), ...runner },
    problem: () => Promise.resolve(undefined),
    tokens: new Tokens(dir, `klipp=${KLIPP}`),
    log,
    maxRuns: 1,
    keepAliveMs: 50,
    toolTimeoutMs: 60_000,
    ...deps,
  });
  let hungUp = () => {};
  const gone = new Promise<void>((done) => (hungUp = done));
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.on('close', hungUp);
    v1.handle(req, res, req.url ?? '').catch(() => res.end());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const started: BoxServer & { log: RunLog; gone: Promise<void>; requests: () => number } = {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    log,
    gone,
    requests: () => requests,
    close: () =>
      new Promise<void>((done) => {
        v1.close();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
  boxes.push(started);
  return started;
}

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

  it('counts an agent that isn’t signed in as unable to run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klipp-box-'));
    const out = await box({ data: dir });
    const body = (await (await fetch(`${out.url}/v1/agents`, { headers: auth() })).json()) as {
      agents: Array<{ id: string; problem?: string }>;
    };
    expect(body.agents[0]!.problem).toBe("Claude isn't signed in. Open the AI box to sign in.");
  });

  it('keeps API keys from the agents: signing in is with the subscription', async () => {
    const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
    const tokens = [...keys, 'CLAUDE_CODE_OAUTH_TOKEN'];
    const before = tokens.map((name) => process.env[name]);
    for (const name of tokens) process.env[name] = 'secret-for-the-test';
    try {
      const out = await box();
      const said = async (agent: string) =>
        textOf(await all(await startRun(out, { agent, message: ask('check the api key') })));
      // The subscription's own token stays; every key that would bill an account goes.
      expect(await said('claude')).toBe('visible: CLAUDE_CODE_OAUTH_TOKEN');
      expect(await said('codex')).toBe('visible: none');
    } finally {
      tokens.forEach((name, i) => {
        if (before[i] === undefined) delete process.env[name];
        else process.env[name] = before[i];
      });
    }
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

  it.skipIf(process.getuid?.() === 0)(
    'a run log that can’t be written refuses the run and leaks no slot',
    async () => {
      const dir = data();
      const one = await box({ data: dir, maxRuns: 1 });
      const runs = join(dir, 'runs');
      chmodSync(runs, 0o500);
      try {
        expect((await startRun(one, { message: ask('hi') })).status).toBe(500);
      } finally {
        chmodSync(runs, 0o700);
      }
      // maxRuns is 1: this only gets in if the refused run didn't keep its slot.
      const next = await startRun(one, { message: ask('who are you') });
      expect(next.status).toBe(200);
      expect(textOf(await all(next))).toBe('I am Claude, in a paperclip.');
    },
  );

  it('answers a tool call once: a second answer to it gets 404', async () => {
    const results: McpResult[] = [];
    const b = await bare({
      run: async (_request, hooks) => {
        results.push(await hooks.onTool('point_at_element', {}));
        await forever(hooks.signal); // the run stays live after the answer
      },
    });
    const leave = new AbortController();
    const response = await startRun(b, { message: ask('hi') }, KLIPP, leave.signal);
    let run = '';
    let call = '';
    for await (const line of lines(response)) {
      if (line && line.type === 'run') run = String(line.id);
      if (line && line.type === 'tool_call') {
        call = String(line.id);
        break;
      }
    }
    // Two answers whose bodies are still on their way: the box has both requests, so it must
    // decide who answered first when the bodies end, not when the requests arrive.
    const slowly = (content: string) => {
      const text = new TextEncoder().encode(JSON.stringify({ content }));
      let finish = () => {};
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(text.slice(0, 1));
          finish = () => {
            controller.enqueue(text.slice(1));
            controller.close();
          };
        },
      });
      const status = fetch(`${b.url}/v1/runs/${run}/tools/${call}`, {
        method: 'POST',
        headers: auth(),
        body,
        duplex: 'half',
      } as RequestInit).then((r) => r.status);
      return { status, finish: () => finish() };
    };
    const first = slowly('one');
    const second = slowly('two');
    while (b.requests() < 3) await new Promise((done) => setTimeout(done, 5)); // the run, then both
    first.finish();
    expect(await first.status).toBe(204);
    second.finish();
    expect(await second.status).toBe(404);
    expect(results.map((r) => r.text)).toEqual(['one']);
    const answer = async (content: string) =>
      (
        await fetch(`${b.url}/v1/runs/${run}/tools/${call}`, {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({ content }),
        })
      ).status;
    // Later, with the run still live: the call was answered already.
    expect(await answer('three')).toBe(404);
    leave.abort();
  });

  it('a client that leaves while the box checks its agent takes no slot', async () => {
    let checking = () => {};
    const entered = new Promise<void>((done) => (checking = done));
    let release = () => {};
    const gate = new Promise<void>((done) => (release = done));
    let started = 0;
    const b = await bare(
      {
        run: async (_request, { signal }) => {
          started++;
          await forever(signal);
        },
      },
      {
        problem: async () => {
          checking();
          await gate;
          return undefined;
        },
      },
    );
    const leave = new AbortController();
    const left = startRun(b, { message: ask('hi') }, KLIPP, leave.signal).catch(() => undefined);
    await entered;
    leave.abort();
    await b.gone; // the box has seen the client go
    release();
    await left;
    // maxRuns is 1: this only gets in if the client that left kept no slot.
    const stay = new AbortController();
    const next = await startRun(b, { message: ask('hi') }, KLIPP, stay.signal);
    expect(next.status).toBe(200);
    expect(started).toBe(1);
    stay.abort();
  });

  it('gives up on a tool call nobody answers, and the run goes on', async () => {
    const dir = data();
    const quick = await box({ data: dir, toolTimeoutMs: 100 });
    const events = await all(await startRun(quick, { message: ask('the button is broken') }));
    expect(textOf(events)).toBe('No problem.');
    expect(events.at(-1)).toEqual({ type: 'done' });
    const run = String(events[0]!.id);
    const file = readdirSync(join(dir, 'runs')).find((name) => name.endsWith(`${run}.jsonl`))!;
    const logged = readFileSync(join(dir, 'runs', file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged.find((line) => line.type === 'tool_result')).toMatchObject({
      content: 'Nobody answered in time.',
      isError: true,
    });
  });

  it('tells the caller when the run can’t start, and ends it as an error', async () => {
    const b = await bare({ run: () => Promise.reject(new Error('The bridge would not start.')) });
    const events = await all(await startRun(b, { message: ask('hi') }));
    expect(events).toEqual([
      { type: 'run', id: events[0]!.id },
      { type: 'error', message: 'The bridge would not start.' },
    ]);
    expect(b.log.list()[0]).toMatchObject({ live: false, outcome: 'error' });
    // maxRuns is 1: the failed run kept no slot.
    expect((await startRun(b, { message: ask('hi') })).status).toBe(200);
  });

  it('answers 400 to a request that isn’t JSON and 500 to the box’s own failure', async () => {
    expect(
      (await fetch(`${main.url}/v1/runs`, { method: 'POST', headers: auth(), body: '{nope' }))
        .status,
    ).toBe(400);
    // A command list with no command: the box's setup is wrong, not the caller's request.
    const misconfigured = await box({ commands: { claude: [], codex: fakeAgent } });
    expect((await startRun(misconfigured, { message: ask('hi') })).status).toBe(500);
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
