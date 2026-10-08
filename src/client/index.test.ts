// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentsResponse } from '../shared/protocol.js';
import type { RuntimeConfig } from '../shared/runtime-config.js';
import { resetCapture } from './capture.js';
import { listAgents } from './chat-client.js';
import { start } from './index.js';
import { createApp } from './ui/app.js';

vi.mock('./capture.js', () => ({ startCapture: vi.fn(), resetCapture: vi.fn() }));
vi.mock('./chat-client.js', () => ({ listAgents: vi.fn(), pair: vi.fn() }));
vi.mock('./ui/app.js', () => ({ createApp: vi.fn() }));
const config: RuntimeConfig = {
  dev: false,
  endpoint: '/@klipp/',
  manifestUrl: '/manifest.json',
  hotkey: 'alt+shift+k',
  chat: true,
  launcher: 'bottom-right',
  launcherUnderAutomation: true,
  keepQuery: [],
  offset: { x: 0, y: 0 },
};
const answers = (available: boolean): AgentsResponse => ({
  preferred: 'codex',
  agents: [{ id: 'codex', label: 'Codex', available }],
});
const fakeApp = () => ({
  destroy: vi.fn(),
  toggle: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  pick: vi.fn(),
  reveal: vi.fn(),
  notify: vi.fn(),
  showFigure: vi.fn(),
});
let created: Array<ReturnType<typeof fakeApp>>;
const watchListeners = () => vi.spyOn(window, 'addEventListener');
let listeners: ReturnType<typeof watchListeners>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  created = [];
  listeners = watchListeners();
  vi.mocked(createApp).mockImplementation(() => {
    const app = fakeApp();
    created.push(app);
    return app;
  });
  vi.mocked(listAgents).mockResolvedValue(answers(false));
});
afterEach(() => {
  for (const [type, listener, options] of listeners.mock.calls)
    window.removeEventListener(type, listener, options);
  delete window.klipp;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('resets synchronously, including diagnostics and a pending lazy import, then creates a fresh app', async () => {
  start({ ...config, launcher: false });
  const loading = window.klipp!.app();
  const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  window.klipp!.reset();
  expect(resetCapture).toHaveBeenCalledOnce();
  await rejected;
  expect(created).toHaveLength(0);
  const first = await window.klipp!.app();
  localStorage.setItem('klipp:agent', 'claude');
  window.klipp!.reset();
  expect(created[0]!.destroy).toHaveBeenCalledOnce();
  expect(localStorage.getItem('klipp:agent')).toBeNull();
  const next = await window.klipp!.app();
  expect(next).not.toBe(first);
});

it.each(['focus', 'online', 'backoff'])(
  'recovers the hidden production launcher on %s',
  async (trigger) => {
    start(config);
    await vi.advanceTimersByTimeAsync(300);
    expect(listAgents).toHaveBeenCalledOnce();
    expect(created).toHaveLength(0);
    vi.mocked(listAgents).mockResolvedValue(answers(true));
    if (trigger === 'backoff') await vi.advanceTimersByTimeAsync(1000);
    else window.dispatchEvent(new Event(trigger));
    await vi.waitFor(() => expect(created[0]?.showFigure).toHaveBeenCalledOnce());
    expect(listAgents).toHaveBeenCalledTimes(2);
  },
);

it('bounds launcher backoff and cancels an old availability check on reset', async () => {
  start(config);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(listAgents).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(listAgents).toHaveBeenCalledTimes(6);
  let finish!: (answer: AgentsResponse) => void;
  vi.mocked(listAgents).mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  window.dispatchEvent(new Event('focus'));
  const signal = vi.mocked(listAgents).mock.calls.at(-1)![1]!;
  window.klipp!.reset();
  expect(signal.aborted).toBe(true);
  finish(answers(true));
  await Promise.resolve();
  await Promise.resolve();
  expect(created).toHaveLength(0);
});
