import type { Capture } from '../screenshot.js';
import { h } from './dom.js';

/** Every capture has a fresh, explicit decision. Closing or Escape denies it. */
export class ScreenshotCard {
  readonly element: HTMLElement;
  readonly decision: Promise<boolean>;
  private decide!: (approved: boolean) => void;
  private readonly actions: HTMLElement;
  private readonly status = h('p', { role: 'status' });

  constructor(capture: Capture) {
    this.decision = new Promise((done) => {
      this.decide = done;
    });
    capture.preview.className = 'screenshot-preview';
    capture.preview.setAttribute('aria-label', 'Redacted screenshot preview');
    this.actions = h(
      'div',
      { class: 'row' },
      h(
        'button',
        { type: 'button', class: 'btn primary', onclick: () => this.decide(true) },
        'Approve',
      ),
      h(
        'button',
        { type: 'button', class: 'btn', onclick: () => this.decide(false) },
        "Don't send",
      ),
    );
    this.element = h(
      'div',
      { class: 'msg klipp card screenshot-card' },
      h('div', { class: 'card-title' }, 'Send this screenshot?'),
      h(
        'p',
        {},
        'Text, form values and private elements are redacted. Canvas pixels may contain private information. Review them before approving.',
      ),
      capture.preview,
      capture.warnings.length ? h('p', {}, capture.warnings.join(' ')) : undefined,
      this.actions,
      this.status,
    );
    void this.decision.then((approved) => {
      this.actions.remove();
      this.status.textContent = approved ? 'Approved for the agent.' : 'Not sent.';
      if (!approved) capture.preview.remove();
    });
  }
  deny() {
    this.decide(false);
  }
}
