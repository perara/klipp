import type { RuntimeConfig } from '../shared/runtime-config.js';
import { resetCapture, startCapture } from './capture.js';
import { listAgents, pair } from './chat-client.js';
import { identify, resolve } from './identify.js';
import type { KlippApp } from './ui/app.js';

export type { RuntimeConfig, KlippApp };

/** In the DevTools console: `klipp.id($0)`, `klipp.find('3f9a2c1d.x7k2')`. */
export interface KlippGlobal {
  id(element: Element): string;
  find(id: string): Element | undefined;
  app(): Promise<KlippApp>;
  /** Synchronously clears private session state and cancels pending work. The UI is recreated on use. */
  reset(): void;
}

declare global {
  interface ImportMetaEnv {
    /** True wherever the Klipp Vite plugin is active, including KLIPP=1 builds. */
    readonly KLIPP: boolean;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  interface Window {
    klipp?: KlippGlobal;
  }
}

interface Hotkey {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  key: string;
}

export function parseHotkey(spec: string): Hotkey {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());
  const key = parts.pop() ?? '';
  return {
    alt: parts.includes('alt'),
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    shift: parts.includes('shift'),
    key,
  };
}

/** Letters and digits match by physical key, so Alt on macOS (which changes the character) still works. */
export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean {
  if (
    event.altKey !== hotkey.alt ||
    event.ctrlKey !== hotkey.ctrl ||
    event.metaKey !== hotkey.meta ||
    event.shiftKey !== hotkey.shift
  ) {
    return false;
  }
  if (/^[a-z]$/.test(hotkey.key)) return event.code === `Key${hotkey.key.toUpperCase()}`;
  if (/^[0-9]$/.test(hotkey.key)) return event.code === `Digit${hotkey.key}`;
  return event.key.toLowerCase() === hotkey.key;
}

const PAIR_PARAM = 'klipp-pair';

/**
 * Takes the pairing code out of the address before anything can see or keep it, and pairs
 * this device with the dev server.
 */
function pairFromLink(config: RuntimeConfig, app: () => Promise<KlippApp>, signal: AbortSignal) {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(PAIR_PARAM);
  if (code === null) return;
  url.searchParams.delete(PAIR_PARAM);
  window.history.replaceState(window.history.state, '', url);
  void pair(config.endpoint, code, signal)
    .then((problem) =>
      signal.aborted
        ? undefined
        : app().then((a) =>
            a.notify(
              problem ?? 'This device is paired. Tell me what you noticed!',
              Boolean(problem),
            ),
          ),
    )
    .catch(() => undefined);
}

/** Installs the hotkey, the deep-link handler and the paperclip. The UI itself loads on first use. */
export function start(config: RuntimeConfig): void {
  if (typeof window === 'undefined' || window.klipp) return;
  startCapture();
  let loading: Promise<KlippApp> | undefined;
  let current: KlippApp | undefined;
  let lifetime = new AbortController();
  const app = () => {
    const signal = lifetime.signal;
    return (loading ??= import('./ui/app.js').then((m) => {
      signal.throwIfAborted();
      return (current = m.createApp(config));
    }));
  };
  const useApp = (use: (app: KlippApp) => void) => {
    const signal = lifetime.signal;
    void app()
      .then((a) => {
        if (!signal.aborted) use(a);
      })
      .catch(() => undefined);
  };
  if (config.chat) pairFromLink(config, app, lifetime.signal);
  window.klipp = {
    id: (element) => identify(element).id,
    find: (id) => resolve(id).element,
    app,
    reset() {
      lifetime.abort();
      current?.destroy();
      current = undefined;
      loading = undefined;
      resetCapture();
      try {
        localStorage.removeItem('klipp:agent');
      } catch {
        /* Storage may be blocked. */
      }
      lifetime = new AbortController();
      scheduleLauncher();
    },
  };

  const hotkey = parseHotkey(config.hotkey);
  window.addEventListener(
    'keydown',
    (event) => {
      if (!matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      event.stopPropagation();
      useApp((a) => a.toggle());
    },
    true,
  );

  // A Klipp link can arrive after a client-side navigation too, such as the return from a
  // sign-in page, so the address is watched rather than read once.
  let revealed: string | null = null;
  const followLink = () => {
    const linked = new URLSearchParams(window.location.search).get('klipp');
    if (!linked || linked === revealed) return;
    revealed = linked;
    useApp((a) => {
      void a.reveal(linked);
    });
  };
  followLink();
  const navigation = (window as { navigation?: EventTarget }).navigation;
  if (navigation) navigation.addEventListener('currententrychange', followLink);
  else setInterval(followLink, 1000);
  window.addEventListener('popstate', followLink);

  const automated = navigator.webdriver && !config.launcherUnderAutomation;
  let checking = false;
  let shown = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  function scheduleLauncher() {
    clearTimeout(retry);
    checking = false;
    shown = false;
    attempts = 0;
    if (!config.launcher || automated) return;
    retry = setTimeout(checkLauncher, 300);
  }
  function checkLauncher() {
    if (!config.launcher || automated || shown || checking) return;
    clearTimeout(retry);
    checking = true;
    const signal = lifetime.signal;
    const answering =
      config.dev || !config.chat
        ? Promise.resolve(true)
        : listAgents(config.endpoint, AbortSignal.any([signal, AbortSignal.timeout(5_000)])).then(
            (answer) => answer.agents.some((a) => a.available),
            () => false,
          );
    void answering.then((yes) => {
      if (signal.aborted) return;
      checking = false;
      if (yes) {
        shown = true;
        useApp((a) => a.showFigure());
      } else if (attempts < 5)
        retry = setTimeout(checkLauncher, Math.min(30_000, 1000 * 2 ** attempts++));
    });
  }
  window.addEventListener('focus', checkLauncher);
  window.addEventListener('online', checkLauncher);
  scheduleLauncher();
}
