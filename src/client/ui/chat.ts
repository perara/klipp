import type { AgentId, AgentInfo } from '../../shared/protocol.js';
import { ticketText, TYPE_NAMES, type Ticket } from '../../shared/ticket.js';
import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';

export interface ChatHandlers {
  /** False when the text wasn't taken; it then stays in the input. */
  send(text: string): boolean;
  point(): void;
  detach(): void;
  close(): void;
  switchAgent(agent: AgentId): void;
}

/** One of Klipp's replies, filled in as it streams. */
export class Reply {
  private text = '';
  private frame = 0;

  constructor(
    readonly element: HTMLElement,
    private readonly update: (change: () => void) => void,
  ) {}

  append(delta: string) {
    this.text += delta;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update(() => this.element.replaceChildren(renderMarkdown(this.text)));
    });
  }
}

export type IssueDecision = 'file' | 'decline' | 'superseded' | 'expired';

/**
 * A ticket in the chat, waiting for the user's decision. It shows all of what would be filed:
 * the ticket in full, and the page details Klipp adds under it.
 */
export class TicketCard {
  readonly decision: Promise<IssueDecision>;
  private decide!: (decision: IssueDecision) => void;
  private readonly actions: HTMLElement;
  private readonly status = h('div', { class: 'card-status', role: 'status' });

  constructor(
    readonly element: HTMLElement,
    ticket: Ticket,
    footer: string,
  ) {
    this.decision = new Promise((resolve) => (this.decide = resolve));
    this.actions = h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: () => this.decide('file') },
        'File ticket',
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => this.decide('decline') },
        'Not now',
      ),
    );
    element.classList.add(`type-${ticket.type}`);
    element.append(
      h(
        'div',
        { class: 'card-tags' },
        h('span', { class: 'badge' }, TYPE_NAMES[ticket.type]),
        ticket.severity && h('span', { class: 'tag' }, ticket.severity),
      ),
      h('div', { class: 'card-title' }, ticket.title),
      h('div', { class: 'card-body' }, renderMarkdown(ticketText(ticket))),
      h(
        'details',
        {},
        h('summary', {}, 'Page details added to it'),
        h('pre', { class: 'card-footer' }, footer),
      ),
      this.actions,
      this.status,
    );
    void this.decision.then(() => this.actions.remove());
  }

  supersede() {
    this.decide('superseded');
    this.status.textContent = 'Left for later.';
  }

  /** The turn ended while this was waiting; filing it now would reach no one. */
  expire() {
    this.decide('expired');
    this.status.textContent = 'Klipp stopped waiting for this one. Ask again to file it.';
  }

  filing() {
    this.status.textContent = 'Filing…';
  }

  filed(url: string) {
    const link = /^https:\/\//.test(url)
      ? h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url)
      : url;
    this.status.replaceChildren('Filed: ', link);
  }

  failed(message: string) {
    this.status.textContent = `Couldn't file it: ${message}`;
  }

  declined() {
    this.status.textContent = 'Not filed.';
  }
}

/** The speech bubble: the conversation, an input, and a button to point at something. */
export class ChatView {
  readonly element: HTMLElement;
  private readonly log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  private readonly input = h('textarea', {
    rows: 1,
    placeholder: 'What looks wrong?',
    'aria-label': 'Message Klipp',
  });
  private readonly chip = h('div', { class: 'chip', hidden: true });
  private readonly agents = h('div', {
    class: 'agents',
    role: 'group',
    'aria-label': 'Who answers',
    hidden: true,
  });

  constructor(private readonly handlers: ChatHandlers) {
    const send = () => {
      const text = this.input.value.trim();
      if (!text || !handlers.send(text)) return;
      this.input.value = '';
      this.grow();
    };
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
      }
    });
    this.input.addEventListener('input', () => this.grow());
    this.element = h(
      'section',
      { class: 'chat', role: 'dialog', 'aria-label': 'Klipp', hidden: true },
      h(
        'button',
        { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => handlers.close() },
        '×',
      ),
      this.agents,
      this.log,
      this.chip,
      h(
        'div',
        { class: 'composer' },
        h(
          'button',
          {
            class: 'icon',
            type: 'button',
            'aria-label': 'Point at something',
            title: 'Point at something',
            onclick: () => handlers.point(),
          },
          '📍',
        ),
        this.input,
        h(
          'button',
          { class: 'icon send', type: 'button', 'aria-label': 'Send', onclick: send },
          '➤',
        ),
      ),
    );
    this.chip.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.detach')) handlers.detach();
    });
  }

  /** The agents the user can switch between, with the current one pressed. */
  showAgents(list: AgentInfo[], current: AgentId) {
    const usable = list.filter((agent) => agent.available);
    this.agents.hidden = usable.length === 0;
    this.agents.replaceChildren(
      ...usable.map((agent) =>
        h(
          'button',
          {
            class: 'agent',
            type: 'button',
            'aria-pressed': String(agent.id === current),
            onclick: () => this.handlers.switchAgent(agent.id),
          },
          agent.label,
        ),
      ),
    );
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  show() {
    this.element.hidden = false;
    this.input.focus();
  }

  hide() {
    this.element.hidden = true;
  }

  private grow() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
  }

  private add(element: HTMLElement): HTMLElement {
    this.log.append(element);
    this.log.scrollTop = this.log.scrollHeight;
    return element;
  }

  /** Applies a change and keeps the newest text in view, unless the user had scrolled up to read. */
  private keepInView(change: () => void) {
    const nearEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 120;
    change();
    if (nearEnd) this.log.scrollTop = this.log.scrollHeight;
  }

  user(text: string) {
    this.add(h('div', { class: 'msg user' }, text));
  }

  /** A reply from Klipp; pass text for a whole one, or append to it as it streams. */
  reply(text?: string): Reply {
    const reply = new Reply(this.add(h('div', { class: 'msg klipp' })), (change) =>
      this.keepInView(change),
    );
    if (text) reply.append(text);
    return reply;
  }

  activity(label: string) {
    this.add(h('div', { class: 'activity' }, label));
  }

  ticket(ticket: Ticket, footer: string): TicketCard {
    // Built before it is added, so the whole card scrolls into view.
    const card = new TicketCard(h('div', { class: 'msg klipp card' }), ticket, footer);
    this.add(card.element);
    return card;
  }

  /** Shows which element the next message is about, or nothing. */
  attach(label: string | undefined) {
    this.chip.hidden = !label;
    this.chip.replaceChildren(
      ...(label
        ? [
            h('span', {}, '📍 ', label),
            h(
              'button',
              { class: 'detach', type: 'button', 'aria-label': 'Forget this element' },
              '×',
            ),
          ]
        : []),
    );
    if (label) this.input.focus();
  }
}
