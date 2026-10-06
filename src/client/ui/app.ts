import type { CanvasTarget } from '../../canvas/registry.js';
import { HOST_ATTR, parseId } from '../../shared/id.js';
import type { KlippManifest } from '../../shared/manifest.js';
import type {
  AgentId,
  AgentInfo,
  ClientToolCall,
  ClientToolResult,
  PageContext,
} from '../../shared/protocol.js';
import type { RuntimeConfig } from '../../shared/runtime-config.js';
import { findTarget, isCanvas, middleOf, targetAt } from '../canvas-targets.js';
import { answerTool, fileIssue, listAgents, talk, Unreachable } from '../chat-client.js';
import { elementContext, pageContext, type Probe } from '../context.js';
import { anchorOf, identify, resolve } from '../identify.js';
import { loadManifest } from '../manifest.js';
import { elementFacts, issueFooter, plain } from '../report.js';
import { ChatView, type Reply, type TicketCard } from './chat.js';
import type { Ticket } from '../../shared/ticket.js';
import { adoptStyles, h } from './dom.js';
import { Figure } from './figure.js';
import { Overlay } from './overlay.js';
import { pageElementsAt, startPicker, type Point } from './picker.js';
import { CSS } from './styles.js';

export interface KlippApp {
  toggle(): void;
  open(): void;
  close(): void;
  /** Lets the user click an element; resolves with it, or undefined if they cancel. */
  pick(prompt?: string): Promise<Picked | undefined>;
  /** Opens the chat on the element a Klipp ID names, waiting for it to render. */
  reveal(id: string): Promise<void>;
  /** Opens the chat with a message from Klipp. */
  notify(text: string, sad?: boolean): void;
  showFigure(): void;
}

export interface Picked {
  element: Element;
  point: Point;
  /** What is drawn there, when the element is a canvas the app registered. */
  target?: CanvasTarget;
}

type Mode = 'closed' | 'open' | 'picking';

const GREETING =
  "Hi, I'm Klipp! Found a bug, or have an idea? Tell me, and tap 📍 to point at what you mean. I'll ask a few questions and write it up as a ticket.";
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
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'copy',
  'cut',
  'select',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerover',
  'pointerout',
  'mousedown',
  'mousemove',
  'mouseup',
  'mouseover',
  'mouseout',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'wheel',
  'dragstart',
  'dragover',
  'drop',
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
  // They stop here, before they bubble out; a page listening on window or document in the
  // capture phase still sees them, as it sees everything.
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
  let pendingCard: TicketCard | undefined;
  /** What the user typed instead of answering the pending card. */
  let typedInstead = '';
  /** The agent asked the user to point, and is waiting. */
  let pickingForAgent = false;
  let agent: AgentId = 'claude';
  let agents: AgentInfo[] = [];
  let agentsLoaded: Promise<void> | undefined;
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
    switchAgent: (id) => switchAgent(id),
  });
  const ui = mount(config, chat, figure);
  const overlay = new Overlay(ui.layer);

  const probe: Probe = {
    hitTest: (x, y) => pageElementsAt(ui.host, { x, y })[0] ?? null,
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

  const fileOf = (path: string) => path.split('/').at(-1);

  /** The overlay label: tag, component, file and line; for a canvas, what is drawn there. */
  function label(element: Element, target?: CanvasTarget): string {
    const { anchor, sid, entry } = entryOf(element);
    const tag = `<${element.localName}>`;
    const drawnBy = target?.sid ? manifest?.entries[target.sid] : undefined;
    if (target && drawnBy) {
      return `${target.label} · ${drawnBy.owner} · ${fileOf(drawnBy.file)}:${drawnBy.line}`;
    }
    const where = !sid
      ? `${tag} · not in the app's code`
      : !entry
        ? `${tag} · ${sid}`
        : `${tag}${anchor === element ? '' : ` in <${entry.name}>`} · ${entry.owner} · ${fileOf(entry.file)}:${entry.line}`;
    return target ? `${target.label} · ${where}` : where;
  }

  /** How the chat names what was picked. */
  function named({ element, target }: Picked): string {
    const { entry } = entryOf(element);
    if (target) {
      // The component that drew it, else the one that holds the canvas.
      const owner = (target.sid ? manifest?.entries[target.sid]?.owner : undefined) ?? entry?.owner;
      return owner ? `${target.label} (${owner})` : target.label;
    }
    const tag = `<${element.localName}>`;
    return entry ? `${tag} in ${entry.owner}` : tag;
  }

  async function contextOf(picked: Picked) {
    await refresh();
    return elementContext(picked.element, manifest, probe, picked.point, picked.target);
  }

  function focusOn(picked: Picked, attach: boolean) {
    subject = picked;
    overlay.show(picked.element, label(picked.element, picked.target), true, picked.target?.box);
    attached = attach;
    chat.attach(attach ? named(picked) : undefined);
  }

  function pick(prompt = 'Click what you mean.'): Promise<Picked | undefined> {
    cancelPicking?.();
    let hovered: { element: Element; point?: Point } | undefined;
    let frame = 0;
    /** Once a frame at most: on a canvas, asking the adapter can take a few milliseconds. */
    const showHover = () => {
      if (frame || !hovered) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (mode !== 'picking' || !hovered) return;
        const target = targetAt(hovered.element, hovered.point);
        overlay.show(hovered.element, label(hovered.element, target), false, target?.box);
      });
    };
    // Labels need the manifest: relabel the hover once it arrives, and resolve only after it.
    const loaded = refresh().then(showHover);
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
        cancelAnimationFrame(frame);
        frame = 0;
        if (!picked) {
          if (subject) {
            overlay.show(
              subject.element,
              label(subject.element, subject.target),
              true,
              subject.target?.box,
            );
          } else overlay.hide();
        }
        void loaded.then(() => resolve(picked));
      };
      cancelPicking = () => {
        stopPicker?.();
        finish();
      };
      stopPicker = startPicker(ui.glass, ui.host, {
        hover: (element, point) => {
          hovered = { element, ...(point ? { point } : {}) };
          showHover();
        },
        pick: (element, point) => {
          const target = targetAt(element, point);
          finish({ element, point, ...(target ? { target } : {}) });
        },
        cancel: () => finish(),
        tracks: isCanvas,
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
      target: subject?.target,
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

  /** Answers a tool call that needs the page or the user, while the agent waits for it. */
  async function runTool(call: ClientToolCall, conversation: string): Promise<ClientToolResult> {
    const { id, input } = call;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    if (call.name === 'point_at_element') {
      const prompt = text(input.prompt);
      chat.reply(prompt);
      pickingForAgent = true;
      const picked = await pick(prompt).finally(() => (pickingForAgent = false));
      if (!picked) return { id, content: 'The user cancelled instead of pointing.' };
      focusOn(picked, false);
      return { id, content: JSON.stringify(await contextOf(picked)) };
    }
    if (call.name === 'inspect_element') {
      const wanted = text(input.id);
      const element = resolve(wanted).element;
      if (!element) {
        return { id, content: `No element with the ID ${wanted} is on the page.`, isError: true };
      }
      const key = parseId(wanted)?.target;
      const target = key === undefined ? undefined : await findTarget(element, key, 2_000);
      if (key !== undefined && !target) {
        return {
          id,
          content: `The canvas is on the page, but it draws nothing called ${key} right now.`,
          isError: true,
        };
      }
      const picked = { element, point: middleOf(element, target), ...(target ? { target } : {}) };
      return { id, content: JSON.stringify(await contextOf(picked)) };
    }
    // The server checked the ticket against its type before handing it over, and files it
    // from its own copy: the page adds only the details shown here.
    const ticket = input as unknown as Ticket;
    const details = footer();
    const card = (pendingCard = chat.ticket(ticket, details));
    figure.mood = 'idle';
    const decision = await card.decision;
    pendingCard = undefined;
    if (decision === 'superseded') {
      return { id, content: `The user didn't file it, and wrote instead: ${typedInstead}` };
    }
    if (decision === 'expired') return { id, content: 'The turn ended.', isError: true };
    if (decision === 'decline') {
      card.declined();
      return { id, content: 'The user decided not to file it.' };
    }
    card.filing();
    try {
      const filed = await fileIssue(config.endpoint, {
        conversation,
        proposal: id,
        footer: details,
      });
      if ('submit' in filed) {
        // The server has no GitHub token: the user submits it there, signed in as themselves.
        if (!/^https:\/\//.test(filed.submit))
          throw new Error('No GitHub address to submit it at.');
        window.open(filed.submit, '_blank', 'noopener');
        card.submitOnGitHub(filed.submit);
        return {
          id,
          content:
            'Not filed yet: GitHub opened in a new tab with the ticket filled in, for the user to submit there.',
        };
      }
      card.filed(filed.url);
      return { id, content: `Filed: ${filed.url}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      card.failed(message);
      return { id, content: `Filing failed: ${message}`, isError: true };
    }
  }

  /** What the agent was waiting on when its turn ended can't reach it any more. */
  function retireToolCalls() {
    pendingCard?.expire();
    pendingCard = undefined;
    if (pickingForAgent) cancelPicking?.();
  }

  /** One message: the agent runs in the background and its work streams in. */
  async function exchange(text: string, page: PageContext): Promise<void> {
    figure.mood = 'thinking';
    let reply: Reply | undefined;
    let failed = false;
    try {
      await agentsLoaded;
      const request = { ...(conversation ? { conversation } : {}), agent, text, page };
      for await (const event of talk(config.endpoint, request)) {
        if (event.type === 'conversation') conversation = event.id;
        else if (event.type === 'text') {
          figure.mood = 'talking';
          (reply ??= chat.reply()).append(event.delta);
        } else if (event.type === 'break') reply = undefined;
        else if (event.type === 'activity') {
          reply = undefined;
          figure.mood = 'thinking';
          chat.activity(event.label);
        } else if (event.type === 'client_tool') {
          reply = undefined;
          const answering = conversation!;
          const { call } = event;
          void runTool(call, answering)
            .catch((error: unknown): ClientToolResult => ({
              id: call.id,
              content: `The page couldn't do that: ${error instanceof Error ? error.message : String(error)}`,
              isError: true,
            }))
            .then((result) => {
              figure.mood = 'thinking';
              return answerTool(config.endpoint, { conversation: answering, ...result });
            });
        } else if (event.type === 'error') {
          failed = true;
          reply = undefined;
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
      retireToolCalls();
    }
    figure.mood = failed ? 'sad' : 'idle';
  }

  /** What the user typed while Klipp was still answering: sent together, once it is done. */
  const queued: string[] = [];

  function send(text: string): boolean {
    if (pendingCard) {
      // The agent is waiting on the draft; what the user typed becomes the answer.
      chat.user(text);
      typedInstead = text;
      pendingCard.supersede();
      return true;
    }
    chat.user(text);
    if (busy) queued.push(text);
    else run(text);
    return true;
  }

  function run(text: string) {
    // Taken now, not after the element's context is ready, so a second message waits.
    busy = true;
    const carried = attached ? subject : undefined;
    attached = false;
    chat.attach(undefined);
    void (async () => {
      try {
        const element = carried ? await contextOf(carried) : undefined;
        await exchange(text, pageContext(config.keepQuery, element));
      } catch (error) {
        chat.reply(error instanceof Error ? error.message : String(error));
        figure.mood = 'sad';
      } finally {
        busy = false;
        if (queued.length) run(queued.splice(0).join('\n\n'));
      }
    })();
  }

  const AGENT_KEY = 'klipp:agent';

  function loadAgents(): Promise<void> {
    agentsLoaded ??= listAgents(config.endpoint)
      .then((answer) => {
        agents = answer.agents;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(AGENT_KEY);
        } catch {
          // Storage can be blocked; the server's preference stands.
        }
        const usable = agents.filter((a) => a.available);
        agent = usable.find((a) => a.id === saved)?.id ?? answer.preferred;
        chat.showAgents(agents, agent);
        if (!usable.length) {
          chat.reply(
            answer.problem ??
              'I need **Claude Code** (`claude`) or **Codex** (`codex`) on this machine, logged in. Install one and restart the dev server.',
          );
          figure.mood = 'sad';
        }
      })
      .catch((error: unknown) => {
        // No chat server is fine (a static deploy still points and links); a refusal says why.
        if (error instanceof Unreachable || !(error instanceof Error)) return;
        chat.reply(error.message);
        figure.mood = 'sad';
      });
    return agentsLoaded;
  }

  function switchAgent(id: AgentId) {
    if (busy || id === agent) return;
    agent = id;
    conversation = undefined;
    try {
      localStorage.setItem(AGENT_KEY, id);
    } catch {
      // Remembering the choice is a nicety.
    }
    chat.showAgents(agents, agent);
    const label = agents.find((a) => a.id === id)?.label ?? id;
    chat.reply(`${label} is answering now, starting a fresh conversation.`);
  }

  function open(greet = true) {
    if (mode !== 'closed') return;
    mode = 'open';
    chat.show();
    void loadAgents();
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
    // The ID comes from a link anyone could craft: it is checked before it is shown, and what
    // it names on a canvas is never echoed back.
    const parsed = parseId(id);
    if (!parsed) {
      chat.reply("That link doesn't name an element I know how to find.");
      figure.mood = 'sad';
      return;
    }
    const element = await waitFor(() => resolve(id).element, 10_000);
    if (!element) {
      chat.reply(`I couldn't find \`${id.trim()}\` on this page.`);
      figure.mood = 'sad';
      return;
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise(requestAnimationFrame);
    await refresh();
    const target =
      parsed.target === undefined ? undefined : await findTarget(element, parsed.target);
    const picked = { element, point: middleOf(element, target), ...(target ? { target } : {}) };
    focusOn(picked, true);
    if (parsed.target !== undefined && !target) {
      chat.reply(
        'I found the canvas from the link, but not what it points at on it. It may have moved out of view. What would you like to know?',
      );
      return;
    }
    const entry = target?.sid ? manifest?.entries[target.sid] : entryOf(element).entry;
    const where = entry ? ` (\`${fileOf(entry.file)}:${entry.line}\`)` : '';
    chat.reply(
      `This is the ${target ? 'thing' : 'element'} from the link: **${plain(named(picked))}**${where}. What would you like to know about it?`,
    );
  }

  // Escape inside Klipp closes it; Escape on the page stays the page's. (Picking, which covers
  // the page, takes Escape wherever it is pressed.)
  ui.layer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || mode !== 'open' || event.isComposing) return;
    event.preventDefault();
    close();
  });
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
    notify(text, sad = false) {
      greeted = true;
      open(false);
      chat.reply(text);
      figure.mood = sad ? 'sad' : 'idle';
    },
    showFigure() {
      if (!figure.button.hidden) return;
      figure.button.hidden = false;
      figure.greet();
    },
  };
}
