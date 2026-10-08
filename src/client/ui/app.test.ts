// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentsResponse, ChatEvent, ChatRequest } from '../../shared/protocol.js';
import type { RuntimeConfig } from '../../shared/runtime-config.js';
import { captureScreenshot } from '../screenshot.js';
import { createApp, type KlippApp } from './app.js';

vi.mock('../screenshot.js', () => ({ captureScreenshot: vi.fn() }));
const config: RuntimeConfig = {
  dev: true,
  endpoint: '/@klipp/',
  manifestUrl: '/manifest.json',
  hotkey: 'alt+shift+k',
  chat: true,
  launcher: false,
  launcherUnderAutomation: true,
  keepQuery: [],
  offset: { x: 0, y: 0 },
};
const available = (claude = true, codex = true): AgentsResponse => ({
  preferred: 'claude',
  agents: [
    { id: 'claude', label: 'Claude', available: claude },
    { id: 'codex', label: 'Codex', available: codex },
  ],
});
let discovery: AgentsResponse | Error;
let calls: Array<{ path: string; init?: RequestInit }>;
let streams: ReadableStreamDefaultController<Uint8Array>[];
let app: KlippApp;
let discoveries: number;
let cancelled: number;
let issue: Promise<Response>;
const root = () => document.querySelector('klipp-root')!.shadowRoot!;
const send = (text: string) => {
  root().querySelector('textarea')!.value = text;
  root().querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
};
const emit = (event: ChatEvent, index = 0) =>
  streams[index]!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
const chats = () => calls.filter((c) => c.path.endsWith('/chat'));
const request = (index = 0) => JSON.parse(chats()[index]!.init?.body as string) as ChatRequest;
const ready = async () => {
  app.open();
  await vi.waitFor(() => expect(root().querySelector('.agents')!.children.length).toBe(2));
};
const settle = () => new Promise((done) => setTimeout(done, 30));

beforeEach(() => {
  discovery = available();
  discoveries = 0;
  cancelled = 0;
  calls = [];
  streams = [];
  localStorage.clear();
  issue = Promise.resolve(Response.json({ url: 'https://github.com/a/b/issues/1' }));
  vi.mocked(captureScreenshot).mockResolvedValue({
    preview: document.createElement('canvas'),
    warnings: [],
    image: { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1, height: 1 },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      calls.push({ path: String(path), ...(init ? { init } : {}) });
      if (String(path).endsWith('/agents')) {
        discoveries++;
        return discovery instanceof Error
          ? Promise.reject(discovery)
          : Promise.resolve(Response.json(discovery));
      }
      if (String(path).endsWith('/chat'))
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streams.push(controller);
              },
              cancel() {
                cancelled++;
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        );
      if (String(path).endsWith('/issue')) return issue;
      return Promise.resolve(Response.json({ version: 1, entries: {} }));
    }),
  );
  app = createApp(config);
});
afterEach(() => {
  app.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('destroys transcripts, drafts, queued sends and the old stream before a new session', async () => {
  await ready();
  send('Alice private message');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'conversation', id: 'alice-conversation' });
  emit({ type: 'text', delta: 'Alice private reply' });
  await vi.waitFor(() => expect(root().textContent).toContain('Alice private reply'));
  send('Alice queued message');
  const input = root().querySelector('textarea')!;
  input.value = 'Alice draft';
  emit({ type: 'text', delta: 'Alice late buffered reply' });
  const oldRoot = root();
  const remove = vi.spyOn(window, 'removeEventListener');
  app.destroy();
  expect(chats()[0]!.init?.signal?.aborted).toBe(true);
  expect(input.value).toBe('');
  expect(oldRoot.textContent).not.toContain('Alice');
  expect(document.querySelector('klipp-root')).toBeNull();
  expect(remove.mock.calls.map((c) => c[0])).toEqual(
    expect.arrayContaining(['pointermove', 'scroll', 'resize']),
  );
  await vi.waitFor(() => expect(cancelled).toBe(1));
  app.open(); // A retired instance cannot reopen.
  expect(document.querySelector('klipp-root')).toBeNull();
  app = createApp(config);
  await ready();
  send('Bob message');
  await vi.waitFor(() => expect(chats()).toHaveLength(2));
  expect(request(1).conversation).toBeUndefined();
  expect(root().textContent).not.toContain('Alice');
});

it('denies pending screenshot consent and suppresses its late tool answer', async () => {
  await ready();
  send('screenshot');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'conversation', id: 'alice' });
  emit({ type: 'client_tool', call: { id: 'image', name: 'take_screenshot', input: {} } });
  await vi.waitFor(() => expect(root().querySelector('.screenshot-card')).not.toBeNull());
  const approve = root().querySelector<HTMLButtonElement>('.screenshot-card .primary')!;
  app.destroy();
  approve.click();
  await settle();
  expect(calls.some((c) => c.path.endsWith('/tool-result'))).toBe(false);
});

it('discards screenshots that finish capturing after destruction', async () => {
  let finish!: (capture: Awaited<ReturnType<typeof captureScreenshot>>) => void;
  vi.mocked(captureScreenshot).mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await ready();
  send('capture');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'conversation', id: 'alice' });
  emit({ type: 'client_tool', call: { id: 'image', name: 'take_screenshot', input: {} } });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  app.destroy();
  finish({
    preview: document.createElement('canvas'),
    warnings: [],
    image: { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1, height: 1 },
  });
  await settle();
  expect(document.querySelector('klipp-root')).toBeNull();
  expect(calls.some((c) => c.path.endsWith('/tool-result'))).toBe(false);
});

it.each(['unavailable', 'error'])(
  'refreshes %s discovery on reopen and chooses recovered Codex',
  async (failure) => {
    discovery = failure === 'error' ? new Error('down') : available(false, false);
    app.open();
    await vi.waitFor(() => expect(discoveries).toBe(1));
    await settle();
    discovery = available(false, true);
    app.close();
    app.open();
    await vi.waitFor(() => expect(root().querySelector('.agent')?.textContent).toBe('Codex'));
    expect(discoveries).toBe(2);
    send('recovered');
    await vi.waitFor(() => expect(chats()).toHaveLength(1));
    expect(request().agent).toBe('codex');
  },
);

it('refreshes on retry after a chat error without closing', async () => {
  await ready();
  send('first');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'error', message: 'Claude signed out' });
  streams[0]!.close();
  await vi.waitFor(() => expect(root().textContent).toContain('Claude signed out'));
  await settle();
  discovery = available(false, true);
  send('retry');
  await vi.waitFor(() => expect(chats()).toHaveLength(2));
  expect(discoveries).toBe(2);
  expect(request(1).agent).toBe('codex');
});

it('refreshes successful discovery on every open while preserving a usable choice', async () => {
  await ready();
  root().querySelectorAll<HTMLButtonElement>('.agent')[1]!.click();
  discovery = available(true, true);
  app.close();
  app.open();
  await vi.waitFor(() => expect(discoveries).toBe(2));
  await settle();
  expect(root().querySelector('[aria-pressed="true"]')?.textContent).toBe('Codex');
});

const proposal: ChatEvent = {
  type: 'client_tool',
  call: {
    id: 'ticket',
    name: 'propose_ticket',
    input: {
      type: 'question',
      title: 'Alice ticket',
      summary: 'Private summary',
      question: 'Private question',
    },
  },
};

it('clears approved images and expires a pending ticket without filing', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  await ready();
  send('approve screenshot');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'conversation', id: 'alice' });
  emit({ type: 'client_tool', call: { id: 'image', name: 'take_screenshot', input: {} } });
  await vi.waitFor(() => expect(root().querySelector('.screenshot-card .primary')).not.toBeNull());
  root().querySelector<HTMLButtonElement>('.screenshot-card .primary')!.click();
  await vi.waitFor(() =>
    expect(calls.filter((c) => c.path.endsWith('/tool-result'))).toHaveLength(1),
  );
  emit(proposal);
  await vi.waitFor(() =>
    expect(root().querySelector('[aria-label="Attach approved screenshot"]')).not.toBeNull(),
  );
  const file = root().querySelector<HTMLButtonElement>('.type-question .primary')!;
  const oldRoot = root();
  app.destroy();
  file.click();
  await settle();
  expect(oldRoot.querySelector('canvas')).toBeNull();
  expect(calls.some((c) => c.path.endsWith('/issue'))).toBe(false);
  expect(calls.filter((c) => c.path.endsWith('/tool-result'))).toHaveLength(1);
  app = createApp(config);
  await ready();
  send('Bob');
  await vi.waitFor(() => expect(streams).toHaveLength(2));
  emit({ type: 'conversation', id: 'bob' }, 1);
  emit(proposal, 1);
  await vi.waitFor(() => expect(root().querySelector('.type-question')).not.toBeNull());
  expect(root().querySelector('[aria-label="Attach approved screenshot"]')).toBeNull();
});

it('aborts filing and ignores a late prefilled GitHub link', async () => {
  let finish!: (response: Response) => void;
  issue = new Promise((done) => {
    finish = done;
  });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await ready();
  send('file');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  emit({ type: 'conversation', id: 'alice' });
  emit(proposal);
  await vi.waitFor(() => expect(root().querySelector('.type-question .primary')).not.toBeNull());
  root().querySelector<HTMLButtonElement>('.type-question .primary')!.click();
  await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith('/issue'))).toBe(true));
  app.destroy();
  expect(calls.find((c) => c.path.endsWith('/issue'))!.init?.signal?.aborted).toBe(true);
  finish(Response.json({ submit: 'https://github.com/a/b/issues/new?body=Alice' }));
  await settle();
  expect(open).not.toHaveBeenCalled();
  expect(calls.some((c) => c.path.endsWith('/tool-result'))).toBe(false);
});

it('cancels picking and aborts discovery before it can update a retired UI', async () => {
  const pending: Array<{ signal: AbortSignal; finish: (response: Response) => void }> = [];
  vi.mocked(fetch).mockImplementation(
    (_path, init) =>
      new Promise((done) => {
        pending.push({ signal: init!.signal!, finish: done });
      }),
  );
  app.open();
  const picking = app.pick();
  app.destroy();
  expect(await picking).toBeUndefined();
  expect(pending).toHaveLength(2);
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  for (const p of pending) p.finish(Response.json(available()));
  await settle();
  expect(document.querySelector('klipp-root')).toBeNull();
});
