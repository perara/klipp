import { svg } from './dom.js';

/** A gem clip drawn as one wire: three nested loops. */
const WIRE = 'M20 22 V46 A5 5 0 0 0 30 46 V12 A8 8 0 0 0 14 12 V50 A11 11 0 0 0 36 50 V22';

function eye(cx: number, cy: number) {
  return svg(
    'g',
    {},
    svg('circle', { class: 'eye-white', cx, cy, r: 4.6 }),
    svg('circle', { class: 'pupil', cx: cx + 0.9, cy: cy + 0.9, r: 2.1 }),
    svg('circle', { class: 'glint', cx: cx + 1.6, cy: cy + 0.1, r: 0.7 }),
  );
}

/** Klipp: a paperclip with eyes and opinions. */
export function character(className = 'clip'): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 48 64', class: className, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'wire-shade', d: WIRE }),
    svg('path', { class: 'wire', d: WIRE }),
    svg('path', { class: 'wire-shine', d: WIRE }),
    svg('path', { class: 'brow', d: 'M14.5 15.8 Q19 13 23 15.4' }),
    svg('path', { class: 'brow', d: 'M27 15 Q31.5 12.4 35.5 15.6' }),
    svg('g', { class: 'eyes' }, eye(19, 23.5), eye(31, 23.5)),
  );
}
