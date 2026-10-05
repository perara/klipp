import type { RuntimeConfig } from '../shared/runtime-config.js';
import { startCapture } from './capture.js';
import { listAgents, pair } from './chat-client.js';
import { identify, resolve } from './identify.js';
import type { KlippApp } from './ui/app.js';

export type { RuntimeConfig, KlippApp };

/** In the DevTools console: `klipp.id($0)`, `klipp.find('3f9a2c1d.x7k2')`. */
export interface KlippGlobal {
  id(element: Element): string;
  find(id: string): Element | undefined;
  app(): Promise<KlippApp>;
}

declare global {
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

/** Whether the chat server answers this user, with an agent that can run. */
const chatAnswers = (config: RuntimeConfig): Promise<boolean> =>
  listAgents(config.endpoint).then(
    (answer) => answer.agents.some((agent) => agent.available),
    () => false,
  );

/**
 * Takes the pairing code out of the address before anything can see or keep it, and pairs
 * this device with the dev server.
 */
function pairFromLink(config: RuntimeConfig, app: () => Promise<KlippApp>) {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(PAIR_PARAM);
  if (code === null) return;
  url.searchParams.delete(PAIR_PARAM);
  window.history.replaceState(window.history.state, '', url);
  void pair(config.endpoint, code).then((problem) =>
    app().then((a) =>
      a.notify(problem ?? 'This device is paired. Tell me what you noticed!', Boolean(problem)),
    ),
  );
}

/** Installs the hotkey, the deep-link handler and the paperclip. The UI itself loads on first use. */
export function start(config: RuntimeConfig): void {
  if (typeof window === 'undefined' || window.klipp) return;
  startCapture();
  let loading: Promise<KlippApp> | undefined;
  const app = () => (loading ??= import('./ui/app.js').then((m) => m.createApp(config)));
  if (config.chat) pairFromLink(config, app);
  window.klipp = {
    id: (element) => identify(element).id,
    find: (id) => resolve(id).element,
    app,
  };

  const hotkey = parseHotkey(config.hotkey);
  window.addEventListener(
    'keydown',
    (event) => {
      if (!matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      event.stopPropagation();
      void app().then((a) => a.toggle());
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
    void app().then((a) => a.reveal(linked));
  };
  followLink();
  const navigation = (window as { navigation?: EventTarget }).navigation;
  if (navigation) navigation.addEventListener('currententrychange', followLink);
  else setInterval(followLink, 1000);
  window.addEventListener('popstate', followLink);

  const automated = navigator.webdriver && !config.launcherUnderAutomation;
  if (config.launcher && !automated) {
    const show = () => {
      // In a build, the paperclip waits for the chat server to answer: a site without one,
      // or one that won't answer this user, gets no paperclip that can't talk.
      const answering = config.dev || !config.chat ? Promise.resolve(true) : chatAnswers(config);
      void answering.then((yes) => (yes ? app().then((a) => a.showFigure()) : undefined));
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(show, { timeout: 2000 });
    else setTimeout(show, 300);
  }
}
