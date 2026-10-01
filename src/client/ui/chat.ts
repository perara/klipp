import type { IssueDraft } from '../../shared/protocol.js';
import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';

export interface ChatHandlers {
  /** False when Klipp is still answering; the text then stays in the input. */
  send(text: string): boolean;
  point(): void;
  detach(): void;
  close(): void;
}

/** One of Klipp's replies, filled in as it streams. */
export class Reply {
  private text = '';
  private frame = 0;

  constructor(readonly element: HTMLElement) {}

  append(delta: string) {
    this.text += delta;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.element.replaceChildren(renderMarkdown(this.text));
    });
  }
}

export type IssueDecision = 'file' | 'decline' | 'superseded';

/** A draft issue in the chat, waiting for the user's decision. */
export class IssueCard {
  readonly decision: Promise<IssueDecision>;
  private decide!: (decision: IssueDecision) => void;
  private readonly actions: HTMLElement;
  private readonly status = h('div', { class: 'card-status', role: 'status' });

  constructor(
    readonly element: HTMLElement,
    draft: IssueDraft,
  ) {
    this.decision = new Promise((resolve) => (this.decide = resolve));
    this.actions = h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: () => this.decide('file') },
        'File issue',
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => this.decide('decline') },
        'Not now',
      ),
    );
    element.append(
      h('div', { class: 'card-label' }, 'Issue draft'),
      h('div', { class: 'card-title' }, draft.title),
      h(
        'details',
        {},
        h('summary', {}, 'Show the text'),
        h('div', { class: 'card-body' }, renderMarkdown(draft.body)),
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

  filing() {
    this.status.textContent = 'Filing…';
  }

  filed(url: string) {
    this.status.replaceChildren(
      'Filed: ',
      h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url),
    );
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

  constructor(handlers: ChatHandlers) {
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

  user(text: string) {
    this.add(h('div', { class: 'msg user' }, text));
  }

  /** A reply from Klipp; pass text for a whole one, or append to it as it streams. */
  reply(text?: string): Reply {
    const reply = new Reply(this.add(h('div', { class: 'msg klipp' })));
    if (text) reply.append(text);
    return reply;
  }

  activity(label: string) {
    this.add(h('div', { class: 'activity' }, label));
  }

  issue(draft: IssueDraft): IssueCard {
    return new IssueCard(this.add(h('div', { class: 'msg klipp card' })), draft);
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

  scrollToEnd() {
    this.log.scrollTop = this.log.scrollHeight;
  }
}
