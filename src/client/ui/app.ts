import { HOST_ATTR, parseId } from '../../shared/id.js';
import type { KlippManifest, ManifestEntry } from '../../shared/manifest.js';
import type { RuntimeConfig } from '../../shared/runtime-config.js';
import { anchorOf, identify, resolve } from '../identify.js';
import { loadManifest } from '../manifest.js';
import { buildReport, deepLink, elementFacts, visibleText, type ReportEnv } from '../report.js';
import { character } from './character.js';
import { adoptStyles, h } from './dom.js';
import { Overlay } from './overlay.js';
import { renderPanel, type Draft } from './panel.js';
import { centerOf, pageElementsAt, startPicker, type Point } from './picker.js';
import { CSS } from './styles.js';

export interface KlippApp {
  togglePicker(): void;
  pick(): void;
  select(element: Element, point?: Point): Promise<void>;
  /** Opens the panel on the element a Klipp id names, waiting for it to render. */
  reveal(id: string): Promise<void>;
  showLauncher(): void;
  close(): void;
}

type Mode = 'idle' | 'picking' | 'panel';

interface Selection {
  element: Element;
  /** Everything under the point it was picked at, topmost first, for "Beneath". */
  stack: Element[];
  linked: boolean;
  draft: Draft;
}

const GREETED_KEY = 'klipp:greeted';

const kbd = (hotkey: string) =>
  h(
    'kbd',
    {},
    hotkey
      .split('+')
      .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
      .join('+'),
  );

function mount(config: RuntimeConfig) {
  const host = document.createElement('klipp-root');
  const pinned: Array<[string, string]> = [
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '0'],
    ['height', '0'],
    ['margin', '0'],
    ['padding', '0'],
    ['border', '0'],
    ['display', 'block'],
    ['z-index', '2147483647'],
  ];
  for (const [property, value] of pinned) host.style.setProperty(property, value, 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  adoptStyles(shadow, CSS);

  const coarse = matchMedia('(pointer: coarse)').matches;
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const banner = h(
    'div',
    { class: 'banner', role: 'status', hidden: true },
    character(),
    h(
      'span',
      {},
      coarse ? 'Tap what looks wrong.' : 'Click what looks wrong. ',
      !coarse && h('span', { class: 'hint' }, '↑↓ parent/child · Enter picks · Esc cancels'),
    ),
    cancel,
  );
  const launcher = h(
    'button',
    {
      class: 'launcher',
      type: 'button',
      hidden: true,
      'aria-label': 'Klipp: point at something that looks wrong',
    },
    character(),
  );
  const bubbleText = h('span');
  const dismiss = h('button', { class: 'dismiss', type: 'button', 'aria-label': 'Dismiss' }, '×');
  const bubble = h('div', { class: 'bubble', role: 'status', hidden: true }, bubbleText, dismiss);
  const glass = h('div', { class: 'glass', hidden: true });
  const panelSlot = h('div');
  const layer = h('div', { class: `layer ${config.launcher || 'bottom-right'}` });
  layer.append(glass, banner, panelSlot, launcher, bubble);
  shadow.append(layer);
  document.documentElement.append(host);
  return { host, layer, glass, banner, cancel, panelSlot, launcher, bubble, bubbleText, dismiss };
}

function currentEnv(): ReportEnv {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    href: location.href,
    userAgent: navigator.userAgent,
    viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    colorScheme: dark ? 'dark' : 'light',
  };
}

function waitFor<T>(find: () => T | undefined, timeout: number): Promise<T | undefined> {
  const found = find();
  if (found) return Promise.resolve(found);
  return new Promise((done) => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const value = find();
        if (value) finish(value);
      });
    });
    const timer = setTimeout(() => finish(find()), timeout);
    function finish(value: T | undefined) {
      observer.disconnect();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      done(value);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function rememberGreeting(): boolean {
  try {
    if (sessionStorage.getItem(GREETED_KEY)) return true;
    sessionStorage.setItem(GREETED_KEY, '1');
  } catch {
    // Storage can be blocked; greeting again is harmless.
  }
  return false;
}

export function createApp(config: RuntimeConfig): KlippApp {
  const ui = mount(config);
  const overlay = new Overlay(ui.layer);
  let mode: Mode = 'idle';
  let stopPicker: (() => void) | undefined;
  let manifest: KlippManifest | undefined;
  let selection: Selection | undefined;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = async () => {
    manifest = await loadManifest(config);
  };

  function label(element: Element): string {
    const anchor = anchorOf(element);
    const sid = anchor?.getAttribute(HOST_ATTR);
    const tag = `<${element.localName}>`;
    if (!sid) return `${tag} · not in the app's code`;
    const entry = manifest?.entries[sid];
    if (!entry) return `${tag} · ${sid}`;
    const inside = anchor === element ? '' : ` in <${entry.name}>`;
    return `${tag}${inside} · ${entry.owner} · ${entry.file.split('/').at(-1)}:${entry.line}`;
  }

  const describe = (element: Element) => {
    const { id } = identify(element);
    return id ? `<${element.localName}> ${id}` : `<${element.localName}>`;
  };

  /** The page element at a point, looking through Klipp's own UI. */
  function hitTest(x: number, y: number): Element | null {
    ui.host.classList.add('probing');
    try {
      return document.elementFromPoint(x, y);
    } finally {
      ui.host.classList.remove('probing');
    }
  }

  function say(...content: Array<Node | string>) {
    ui.bubbleText.replaceChildren(...content);
    ui.bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 9000);
  }

  function hideBubble() {
    ui.bubble.hidden = true;
  }

  function setMode(next: Mode) {
    mode = next;
    ui.launcher.classList.toggle('active', next !== 'idle');
    ui.banner.hidden = next !== 'picking';
  }

  function close() {
    stopPicker?.();
    stopPicker = undefined;
    ui.panelSlot.replaceChildren();
    overlay.hide();
    selection = undefined;
    setMode('idle');
  }

  function pick() {
    close();
    hideBubble();
    setMode('picking');
    let hovered: Element | undefined;
    void refresh().then(() => {
      if (mode === 'picking' && hovered) overlay.show(hovered, label(hovered));
    });
    stopPicker = startPicker(ui.glass, ui.host, {
      hover: (element) => {
        hovered = element;
        overlay.show(element, label(element));
      },
      pick: (element, point) => {
        stopPicker = undefined;
        void select(element, point);
      },
      cancel: () => {
        stopPicker = undefined;
        close();
      },
    });
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = h('textarea');
      area.value = text;
      ui.layer.append(area);
      area.select();
      try {
        return document.execCommand('copy');
      } finally {
        area.remove();
      }
    }
  }

  function openInEditor(entry: ManifestEntry) {
    if (!manifest?.root) return;
    const file = `${manifest.root}/${entry.file}:${entry.line}:${entry.column}`;
    void fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`);
  }

  function report(current: Selection): string {
    const { element, draft } = current;
    return buildReport({
      identity: identify(element),
      manifest,
      facts: elementFacts(element, hitTest, describe),
      note: draft.note,
      ...(draft.includeText ? { text: visibleText(element) } : {}),
      env: currentEnv(),
    });
  }

  function move(element: Element) {
    if (!selection) return;
    selection.element = element;
    render();
  }

  function render() {
    const current = selection;
    if (!current) return;
    const { element } = current;
    const identity = identify(element);
    overlay.show(element, label(element), true);
    const index = current.stack.indexOf(element);
    const parent = element.parentElement;
    const hasParent = Boolean(parent && parent !== document.documentElement);
    ui.panelSlot.replaceChildren(
      renderPanel({
        identity,
        manifest,
        facts: elementFacts(element, hitTest, describe),
        draft: current.draft,
        linked: current.linked,
        canOpenInEditor: config.dev && Boolean(manifest?.root),
        hasParent,
        hasBeneath: index >= 0 && index < current.stack.length - 1,
        copyReport: () => copyText(report(current)),
        copyLink: () => copyText(deepLink(location.href, identify(element).id)),
        copyId: () => copyText(identify(element).id),
        openInEditor,
        parent: () => hasParent && move(parent!),
        beneath: () => {
          const next = current.stack[index + 1];
          if (next) move(next);
        },
        pickAgain: pick,
        close,
      }),
    );
    keepVisible(element);
  }

  /** When the panel covers the element, scroll the element clear; if the page can't scroll that far, move the panel. */
  function keepVisible(element: Element) {
    const panel = ui.panelSlot.firstElementChild;
    if (!panel) return;
    const covered = () => {
      const p = panel.getBoundingClientRect();
      const r = element.getBoundingClientRect();
      return r.bottom > p.top && r.top < p.bottom && r.right > p.left && r.left < p.right;
    };
    if (!covered()) return;
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
    if (covered()) panel.classList.add('flip');
  }

  async function select(element: Element, point?: Point, linked = false) {
    stopPicker?.();
    stopPicker = undefined;
    const stack = pageElementsAt(ui.host, point ?? centerOf(element));
    selection = {
      element,
      stack: stack.includes(element) ? stack : [element, ...stack],
      linked,
      draft: { note: '', includeText: false },
    };
    setMode('panel');
    overlay.show(element, label(element), true);
    await refresh();
    render();
  }

  async function reveal(id: string) {
    const element = await waitFor(() => resolve(id).element, 10_000);
    if (element) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise(requestAnimationFrame);
      return select(element, undefined, true);
    }
    const sid = parseId(id)?.sid;
    const sameCode = sid ? resolve(sid).candidates[0] : undefined;
    if (sameCode) {
      await select(sameCode, undefined, true);
      say(`Couldn't find ${id} itself; this is the same code elsewhere on the page.`);
    } else {
      say(`Couldn't find ${id} on this page.`);
    }
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || mode !== 'panel') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    },
    true,
  );
  ui.launcher.addEventListener('click', () => (mode === 'idle' ? pick() : close()));
  ui.cancel.addEventListener('click', close);
  ui.dismiss.addEventListener('click', hideBubble);

  return {
    togglePicker: () => (mode === 'picking' ? close() : pick()),
    pick,
    select: (element, point) => select(element, point),
    reveal,
    showLauncher() {
      ui.launcher.hidden = false;
      if (!rememberGreeting()) {
        say('Something look off? Tap me or press ', kbd(config.hotkey), ', then point at it.');
      }
    },
    close,
  };
}
