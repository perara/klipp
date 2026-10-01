import { h } from './dom.js';

/** The box drawn around the hovered or selected element, with a label naming it. */
export class Overlay {
  private readonly box = h('div', { class: 'box', hidden: true });
  private readonly label = h('div', { class: 'label', hidden: true });
  private target: Element | undefined;
  private frame = 0;

  constructor(parent: ParentNode) {
    parent.append(this.box, this.label);
    window.addEventListener('scroll', this.schedule, true);
    window.addEventListener('resize', this.schedule);
  }

  show(target: Element, text: string, selected = false) {
    this.target = target;
    this.label.textContent = text;
    this.box.classList.toggle('selected', selected);
    this.label.classList.toggle('selected', selected);
    this.place();
  }

  hide() {
    this.target = undefined;
    this.box.hidden = true;
    this.label.hidden = true;
  }

  private readonly schedule = () => {
    if (!this.target || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.place();
    });
  };

  private place() {
    const target = this.target;
    if (!target) return;
    const r = target.getBoundingClientRect();
    const shown = target.isConnected && (r.width > 0 || r.height > 0);
    this.box.hidden = !shown;
    this.label.hidden = false;
    if (shown) {
      this.box.style.transform = `translate(${r.left}px, ${r.top}px)`;
      this.box.style.width = `${r.width}px`;
      this.box.style.height = `${r.height}px`;
    }
    const width = this.label.offsetWidth;
    const above = r.top - 24;
    const top = !shown ? 8 : above >= 4 ? above : Math.min(r.bottom + 4, innerHeight - 24);
    const left = Math.max(8, Math.min(shown ? r.left : 8, innerWidth - width - 8));
    this.label.style.transform = `translate(${left}px, ${top}px)`;
  }
}
