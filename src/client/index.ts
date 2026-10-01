import type { RuntimeConfig } from '../shared/runtime-config.js';
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

/** Installs the hotkey, the deep-link handler and the character. The UI itself loads on first use. */
export function start(config: RuntimeConfig): void {
  if (typeof window === 'undefined' || window.klipp) return;
  let loading: Promise<KlippApp> | undefined;
  const app = () => (loading ??= import('./ui/app.js').then((m) => m.createApp(config)));
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
      void app().then((a) => a.togglePicker());
    },
    true,
  );

  const linked = new URLSearchParams(window.location.search).get('klipp');
  if (linked) void app().then((a) => a.reveal(linked));

  const automated = navigator.webdriver && !config.launcherUnderAutomation;
  if (config.launcher && !automated) {
    const show = () => void app().then((a) => a.showLauncher());
    if ('requestIdleCallback' in window) window.requestIdleCallback(show, { timeout: 2000 });
    else setTimeout(show, 300);
  }
}
