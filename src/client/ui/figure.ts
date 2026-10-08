import { h, svg } from './dom.js';

export type Mood = 'idle' | 'hello' | 'thinking' | 'talking' | 'pointing' | 'sad';

/** A gem clip drawn as one wire: three nested loops, standing upright. */
const WIRE = 'M27 34 V66 A6 6 0 0 0 39 66 V18 A10 10 0 0 0 19 18 V72 A13.5 13.5 0 0 0 46 72 V32';
const EYES = [
  { x: 25, y: 28 },
  { x: 40, y: 28 },
];
/** Moods in which the eyes follow the pointer; the others pose them with CSS. */
const TRACKING: ReadonlySet<Mood> = new Set(['idle', 'pointing']);

function eye(x: number, y: number) {
  const pupil = svg(
    'g',
    { class: 'pupil' },
    svg('circle', { class: 'iris', cx: x, cy: y + 0.6, r: 2.9 }),
    svg('circle', { class: 'glint', cx: x + 1, cy: y - 0.5, r: 0.9 }),
  );
  const group = svg(
    'g',
    { class: 'eye' },
    svg('circle', { class: 'white', cx: x, cy: y, r: 6.2 }),
    pupil,
  );
  return { group, pupil };
}

/** Klipp himself: a paperclip with eyes, eyebrows and moods. */
export class Figure {
  readonly button: HTMLButtonElement;
  destroy() {
    window.removeEventListener('pointermove', this.track, true);
    cancelAnimationFrame(this.frame);
    clearTimeout(this.hello);
  }

  private readonly root: SVGSVGElement;
  private readonly pupils: SVGGElement[];
  private current: Mood = 'idle';
  private frame = 0;
  private hello: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const eyes = EYES.map(({ x, y }) => eye(x, y));
    this.pupils = eyes.map((e) => e.pupil);
    this.root = svg(
      'svg',
      {
        viewBox: '0 0 64 96',
        class: 'figure mood-idle',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      svg('ellipse', { class: 'shadow', cx: 32, cy: 91, rx: 15, ry: 3 }),
      svg(
        'g',
        { class: 'body' },
        svg('path', { class: 'wire-shade', d: WIRE }),
        svg('path', { class: 'wire', d: WIRE }),
        svg('path', { class: 'wire-shine', d: WIRE }),
        svg('path', { class: 'brow brow-left', d: 'M17.5 19.5 Q23 15.5 30 18' }),
        svg('path', { class: 'brow brow-right', d: 'M34.5 18 Q41 15 47 19' }),
        ...eyes.map((e) => e.group),
        svg(
          'g',
          { class: 'dots' },
          svg('circle', { cx: 51, cy: 12, r: 1.8 }),
          svg('circle', { cx: 56, cy: 7, r: 2.2 }),
          svg('circle', { cx: 61.5, cy: 1.5, r: 2.6 }),
        ),
      ),
    );
    this.button = h(
      'button',
      {
        class: 'figure-button',
        type: 'button',
        'aria-label': 'Klipp: ask about something on this page',
      },
      this.root,
    );
    // Capture phase: Klipp's own root stops its pointer events from bubbling to the page, and
    // the eyes should follow the pointer over the chat and the picking glass too.
    window.addEventListener('pointermove', this.track, { passive: true, capture: true });
  }

  get mood(): Mood {
    return this.current;
  }

  set mood(next: Mood) {
    clearTimeout(this.hello);
    this.root.classList.replace(`mood-${this.current}`, `mood-${next}`);
    this.current = next;
    if (!TRACKING.has(next))
      for (const pupil of this.pupils) pupil.style.removeProperty('transform');
  }

  /** A hop and a wave, then back to idle. */
  greet() {
    this.mood = 'hello';
    this.hello = setTimeout(() => {
      if (this.current === 'hello') this.mood = 'idle';
    }, 1800);
  }

  private readonly track = (event: PointerEvent) => {
    if (!TRACKING.has(this.current) || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const box = this.root.getBoundingClientRect();
      if (!box.width) return;
      const scale = box.width / 64;
      this.pupils.forEach((pupil, i) => {
        const centre = EYES[i]!;
        const dx = event.clientX - (box.left + centre.x * scale);
        const dy = event.clientY - (box.top + centre.y * scale);
        const length = Math.hypot(dx, dy) || 1;
        const reach = Math.min(2.4, length / 40);
        pupil.style.transform = `translate(${(dx / length) * reach}px, ${(dy / length) * reach}px)`;
      });
    });
  };
}
