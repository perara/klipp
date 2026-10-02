import { composedParent, deepen } from '../composed.js';

export interface Point {
  x: number;
  y: number;
}

export interface PickerEvents {
  /** The pointer is over `element`, at `point` when the pointer (not the keyboard) got there. */
  hover(element: Element, point?: Point): void;
  pick(element: Element, point: Point): void;
  cancel(): void;
  /** Whether what is under the pointer changes within this element, as on a canvas. */
  tracks?(element: Element): boolean;
}

/** Page elements under a point, topmost first, inside open shadow roots too, leaving out Klipp. */
export function pageElementsAt(host: Element, point: Point): Element[] {
  const page = document
    .elementsFromPoint(point.x, point.y)
    .filter((el) => el !== host && el !== document.documentElement && !host.contains(el));
  return deepen(page, point.x, point.y);
}

const isPage = (element: Element | null) =>
  element !== null && element !== document.documentElement;

export function centerOf(element: Element): Point {
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function scrollUnder(element: Element | undefined, dx: number, dy: number) {
  for (let el = element; el; el = composedParent(el) ?? undefined) {
    const style = getComputedStyle(el);
    const scrollsY =
      /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollsX =
      /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if ((dy && scrollsY) || (dx && scrollsX)) {
      el.scrollBy(dx, dy);
      return;
    }
  }
  (document.scrollingElement ?? document.documentElement).scrollBy(dx, dy);
}

/**
 * After a tap, browsers hit-test the click once the touch has ended, which is after the glass
 * is gone, so the click would land on the page. This catches it first.
 */
function swallowNextClick() {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    done();
  };
  const done = () => {
    window.removeEventListener('click', swallow, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(done, 500);
  window.addEventListener('click', swallow, true);
}

/**
 * Picking mode. A transparent glass over the page takes every pointer event, so nothing the
 * user points at reacts (no clicks, no drags, no map pans), and disabled or covered elements
 * can still be picked. Esc cancels; ↑/↓ walk to the parent and back; Enter picks.
 * Returns a function that leaves picking mode.
 */
export function startPicker(glass: HTMLElement, host: Element, events: PickerEvents): () => void {
  let current: Element | undefined;
  let navigated = false;
  const trail: Element[] = [];
  let last: Point = { x: -1, y: -1 };
  const at = (point: Point) => pageElementsAt(host, point)[0];

  const hover = (element: Element, byKeyboard = false) => {
    current = element;
    navigated = byKeyboard;
    if (!byKeyboard) trail.length = 0;
    events.hover(element, byKeyboard ? undefined : last);
  };

  const onMove = (event: PointerEvent) => {
    last = { x: event.clientX, y: event.clientY };
    const element = at(last);
    const moved = element !== current || (element !== undefined && events.tracks?.(element));
    if (element && moved && !navigated) hover(element);
    if (navigated && (Math.abs(event.movementX) > 2 || Math.abs(event.movementY) > 2)) {
      navigated = false;
      if (element) hover(element);
    }
  };

  const onUp = (event: PointerEvent) => {
    if (event.button > 0) return;
    const point = { x: event.clientX, y: event.clientY };
    const element = navigated && current ? current : (at(point) ?? current);
    if (!element) return;
    swallowNextClick();
    stop();
    events.pick(element, point);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    scrollUnder(
      at({ x: event.clientX, y: event.clientY }),
      event.deltaX * scale,
      event.deltaY * scale,
    );
    requestAnimationFrame(() => {
      const element = at(last);
      if (element && !navigated) hover(element);
    });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      stop();
      events.cancel();
    } else if (event.key === 'Enter' && current) {
      stop();
      events.pick(current, last.x >= 0 ? last : centerOf(current));
    } else if (event.key === 'ArrowUp' && current && isPage(composedParent(current))) {
      trail.push(current);
      hover(composedParent(current)!, true);
    } else if (event.key === 'ArrowDown' && trail.length) {
      hover(trail.pop()!, true);
    } else {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onContextMenu = (event: Event) => event.preventDefault();

  glass.addEventListener('pointermove', onMove);
  glass.addEventListener('pointerup', onUp);
  glass.addEventListener('wheel', onWheel, { passive: false });
  glass.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKey, true);
  glass.hidden = false;

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    glass.hidden = true;
    glass.removeEventListener('pointermove', onMove);
    glass.removeEventListener('pointerup', onUp);
    glass.removeEventListener('wheel', onWheel);
    glass.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKey, true);
  }
  return stop;
}
