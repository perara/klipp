import { HOST_ATTR } from '../../shared/id.js';
import type { KlippManifest } from '../../shared/manifest.js';
import type { ChatInput, ClientToolCall, ClientToolResult } from '../../shared/protocol.js';
import type { RuntimeConfig } from '../../shared/runtime-config.js';
import { fileIssue, talk, Unreachable } from '../chat-client.js';
import { elementContext, pageContext, type Probe } from '../context.js';
import { anchorOf, identify, resolve } from '../identify.js';
import { loadManifest } from '../manifest.js';
import { elementFacts, issueFooter } from '../report.js';
import { ChatView, type IssueCard, type Reply } from './chat.js';
import { adoptStyles, h } from './dom.js';
import { Figure } from './figure.js';
import { Overlay } from './overlay.js';
import { centerOf, pageElementsAt, startPicker, type Point } from './picker.js';
import { CSS } from './styles.js';

export interface KlippApp {
  toggle(): void;
  open(): void;
  close(): void;
  /** Lets the user click an element; resolves with it, or undefined if they cancel. */
  pick(prompt?: string): Promise<Picked | undefined>;
  /** Opens the chat on the element a Klipp ID names, waiting for it to render. */
  reveal(id: string): Promise<void>;
  showFigure(): void;
}

export interface Picked {
  element: Element;
  point: Point;
}

type Mode = 'closed' | 'open' | 'picking';

const GREETING = "Hi, I'm Klipp! Tell me what looks wrong, or tap 📍 and point at it.";
const UNREACHABLE =
  "I can't reach my brain from here. The chat runs in the dev server (or `vite preview`).";

function waitFor<T>(find: () => T | undefined, timeout: number): Promise<T | undefined> {
  const found = find();
  if (found) return Promise.resolve(found);
  return new Promise((done) => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const value = find();
        if (value) finish(value);
      });
    });
    const timer = setTimeout(() => finish(find()), timeout);
    function finish(value: T | undefined) {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      done(value);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'paste',
  'copy',
  'cut',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'wheel',
  'focusin',
  'focusout',
] as const;

function mount(config: RuntimeConfig, chat: ChatView, figure: Figure) {
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
  const hintText = h('span');
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const hint = h('div', { class: 'hint', role: 'status', hidden: true }, hintText, cancel);
  const glass = h('div', { class: 'glass', hidden: true });
  figure.button.hidden = true;
  const layer = h('div', { class: `layer ${config.launcher || 'bottom-right'}` });
  layer.style.setProperty('--dx', `${config.offset.x}px`);
  layer.style.setProperty('--dy', `${config.offset.y}px`);
  layer.append(glass, chat.element, hint, figure.button);
  // What happens in Klipp stays in Klipp. Events from inside a shadow root reach the page
  // looking as if they came from <klipp-root>, so a page's "is the user typing?" check fails:
  // Backspace in the chat would undo a drawing, a press on the glass would close a popover.
  for (const type of ISOLATED_EVENTS)
    layer.addEventListener(type, (event) => event.stopPropagation());
  shadow.append(layer);
  document.documentElement.append(host);
  return { host, layer, glass, hint, hintText, cancel };
}

export function createApp(config: RuntimeConfig): KlippApp {
  let mode: Mode = 'closed';
  let manifest: KlippManifest | undefined;
  let conversation: string | undefined;
  let busy = false;
  let greeted = false;
  /** The element under discussion, highlighted on the page. */
  let subject: Picked | undefined;
  /** Whether the next message carries the subject. */
  let attached = false;
  let pendingCard: IssueCard | undefined;
  let stopPicker: (() => void) | undefined;
  let cancelPicking: (() => void) | undefined;

  const figure = new Figure();
  const chat = new ChatView({
    send: (text) => send(text),
    point: () => void pickSubject(),
    detach: () => {
      attached = false;
      chat.attach(undefined);
    },
    close: () => close(),
  });
  const ui = mount(config, chat, figure);
  const overlay = new Overlay(ui.layer);

  const probe: Probe = {
    hitTest(x, y) {
      ui.host.classList.add('probing');
      try {
        return document.elementFromPoint(x, y);
      } finally {
        ui.host.classList.remove('probing');
      }
    },
    elementsAt: (x, y) => pageElementsAt(ui.host, { x, y }),
  };

  const refresh = async () => {
    manifest = await loadManifest(config);
  };

  function entryOf(element: Element) {
    const anchor = anchorOf(element);
    const sid = anchor?.getAttribute(HOST_ATTR);
    return { anchor, sid, entry: sid ? manifest?.entries[sid] : undefined };
  }

  /** The overlay label: tag, component, file and line. */
  function label(element: Element): string {
    const { anchor, sid, entry } = entryOf(element);
    const tag = `<${element.localName}>`;
    if (!sid) return `${tag} · not in the app's code`;
    if (!entry) return `${tag} · ${sid}`;
    const inside = anchor === element ? '' : ` in <${entry.name}>`;
    return `${tag}${inside} · ${entry.owner} · ${entry.file.split('/').at(-1)}:${entry.line}`;
  }

  /** How the chat names an element. */
  function named(element: Element): string {
    const { entry } = entryOf(element);
    const tag = `<${element.localName}>`;
    return entry ? `${tag} in ${entry.owner}` : tag;
  }

  async function contextOf(picked: Picked) {
    await refresh();
    return elementContext(picked.element, manifest, probe, picked.point);
  }

  function focusOn(picked: Picked, attach: boolean) {
    subject = picked;
    overlay.show(picked.element, label(picked.element), true);
    attached = attach;
    chat.attach(attach ? named(picked.element) : undefined);
  }

  function pick(prompt = 'Click what you mean.'): Promise<Picked | undefined> {
    cancelPicking?.();
    let hovered: Element | undefined;
    // Labels need the manifest: relabel the hover once it arrives, and resolve only after it.
    const loaded = refresh().then(() => {
      if (mode === 'picking' && hovered) overlay.show(hovered, label(hovered));
    });
    return new Promise((resolve) => {
      mode = 'picking';
      chat.hide();
      ui.hintText.textContent = `${prompt} `;
      ui.hint.hidden = false;
      figure.mood = 'pointing';
      const finish = (picked?: Picked) => {
        stopPicker = undefined;
        cancelPicking = undefined;
        ui.hint.hidden = true;
        figure.mood = 'idle';
        mode = 'open';
        chat.show();
        if (!picked) {
          if (subject) overlay.show(subject.element, label(subject.element), true);
          else overlay.hide();
        }
        void loaded.then(() => resolve(picked));
      };
      cancelPicking = () => {
        stopPicker?.();
        finish();
      };
      stopPicker = startPicker(ui.glass, ui.host, {
        hover: (element) => {
          hovered = element;
          overlay.show(element, label(element));
        },
        pick: (element, point) => finish({ element, point }),
        cancel: () => finish(),
      });
    });
  }

  async function pickSubject() {
    const picked = await pick();
    if (picked) focusOn(picked, true);
  }

  function footer(): string {
    const element = subject?.element;
    return issueFooter({
      identity: element ? identify(element) : undefined,
      facts: element
        ? elementFacts(
            element,
            probe.hitTest,
            (other) => `<${other.localName}> ${identify(other).id}`,
          )
        : undefined,
      manifest,
      href: location.href,
      browser: `${navigator.userAgent}, ${innerWidth}×${innerHeight}`,
      keepQuery: config.keepQuery,
    });
  }

  /** Answers a tool call that needs the page or the user; undefined when a new message overtook it. */
  async function runTool(call: ClientToolCall): Promise<ClientToolResult | undefined> {
    const { id, input } = call;
    if (call.name === 'point_at_element') {
      chat.reply(String(input.prompt));
      const picked = await pick(String(input.prompt));
      if (!picked) return { id, content: 'The user cancelled instead of pointing.' };
      focusOn(picked, false);
      return { id, content: JSON.stringify(await contextOf(picked)) };
    }
    if (call.name === 'inspect_element') {
      const element = resolve(String(input.id)).element;
      if (!element) {
        return {
          id,
          content: `No element with the ID ${String(input.id)} is on the page.`,
          isError: true,
        };
      }
      return {
        id,
        content: JSON.stringify(await contextOf({ element, point: centerOf(element) })),
      };
    }
    const draft = { title: String(input.title), body: String(input.body) };
    const card = (pendingCard = chat.issue(draft));
    const decision = await card.decision;
    pendingCard = undefined;
    if (decision === 'superseded') return undefined;
    if (decision === 'decline') {
      card.declined();
      return { id, content: 'The user decided not to file it.' };
    }
    card.filing();
    try {
      const url = await fileIssue(config.endpoint, {
        ...draft,
        body: `${draft.body}\n\n${footer()}`,
      });
      card.filed(url);
      return { id, content: `Filed: ${url}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      card.failed(message);
      return { id, content: `Filing failed: ${message}`, isError: true };
    }
  }

  async function exchange(input: ChatInput): Promise<void> {
    busy = true;
    figure.mood = 'thinking';
    let reply: Reply | undefined;
    let calls: ClientToolCall[] = [];
    let failed = false;
    try {
      const request = conversation ? { conversation, input } : { input };
      for await (const event of talk(config.endpoint, request)) {
        if (event.type === 'conversation') conversation = event.id;
        else if (event.type === 'text') {
          figure.mood = 'talking';
          (reply ??= chat.reply()).append(event.delta);
        } else if (event.type === 'activity') {
          reply = undefined;
          figure.mood = 'thinking';
          chat.activity(event.label);
        } else if (event.type === 'client_tools') calls = event.calls;
        else if (event.type === 'error') {
          failed = true;
          chat.reply(event.message);
        }
      }
    } catch (error) {
      failed = true;
      chat.reply(
        error instanceof Unreachable
          ? UNREACHABLE
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      busy = false;
    }
    figure.mood = failed ? 'sad' : 'idle';
    if (!calls.length) return;
    const results: ClientToolResult[] = [];
    for (const call of calls) {
      const result = await runTool(call);
      if (!result) return;
      results.push(result);
    }
    await exchange({ type: 'tool_results', results });
  }

  function send(text: string): boolean {
    if (busy) return false;
    pendingCard?.supersede();
    chat.user(text);
    const carried = attached ? subject : undefined;
    attached = false;
    chat.attach(undefined);
    void (async () => {
      const element = carried ? await contextOf(carried) : undefined;
      await exchange({ type: 'text', text, page: pageContext(config.keepQuery, element) });
    })();
    return true;
  }

  function open(greet = true) {
    if (mode !== 'closed') return;
    mode = 'open';
    chat.show();
    if (greet && !greeted) {
      greeted = true;
      chat.reply(GREETING);
      figure.greet();
    }
  }

  function close() {
    cancelPicking?.();
    chat.hide();
    overlay.hide();
    subject = undefined;
    attached = false;
    chat.attach(undefined);
    mode = 'closed';
  }

  async function reveal(id: string) {
    greeted = true;
    open(false);
    const element = await waitFor(() => resolve(id).element, 10_000);
    if (!element) {
      chat.reply(`I couldn't find \`${id}\` on this page.`);
      figure.mood = 'sad';
      return;
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise(requestAnimationFrame);
    await refresh();
    focusOn({ element, point: centerOf(element) }, true);
    const { entry } = entryOf(element);
    const where = entry ? ` (\`${entry.file.split('/').at(-1)}:${entry.line}\`)` : '';
    chat.reply(
      `This is the element from the link: **${named(element)}**${where}. What would you like to know about it?`,
    );
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || mode !== 'open') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    },
    true,
  );
  figure.button.addEventListener('click', () => {
    if (mode === 'picking') cancelPicking?.();
    else if (mode === 'open') close();
    else open();
  });
  ui.cancel.addEventListener('click', () => cancelPicking?.());

  return {
    toggle: () => (mode === 'closed' ? open() : close()),
    open: () => open(),
    close,
    pick,
    reveal,
    showFigure() {
      if (!figure.button.hidden) return;
      figure.button.hidden = false;
      figure.greet();
    },
  };
}
