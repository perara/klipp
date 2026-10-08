import { abortable } from '../shared/abort.js';
import { canvasAdapterFor, type CanvasTarget, type Point } from '../canvas/registry.js';

let warned = false;

/** An adapter is the app's code: a bug in it is reported once and otherwise ignored. */
function quietly<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    if (!warned) console.warn('[klipp] A canvas adapter failed:', error);
    warned = true;
    return undefined;
  }
}

/** Whether `element` is (in) a canvas the app registered, so what is under the pointer can change. */
export const isCanvas = (element: Element): boolean => canvasAdapterFor(element) !== undefined;

/** What the app's adapter says is drawn at `point` on `element`, if it is a registered canvas. */
export function targetAt(element: Element, point: Point | undefined): CanvasTarget | undefined {
  const found = canvasAdapterFor(element);
  if (!found || !point) return undefined;
  return quietly(() => found.adapter.at(point, found.canvas));
}

/**
 * Finds what `key` names on a registered canvas, asking again for a while: following a link,
 * the map or scene may still be loading.
 */
export async function findTarget(
  element: Element,
  key: string,
  timeout = 10_000,
  signal?: AbortSignal,
): Promise<CanvasTarget | undefined> {
  signal?.throwIfAborted();
  const found = canvasAdapterFor(element);
  if (!found?.adapter.find) return undefined;
  const { adapter, canvas } = found;
  const deadline = Date.now() + timeout;
  for (;;) {
    const asked = quietly(() => adapter.find?.(key, canvas));
    const finding = Promise.resolve(asked).catch(() => undefined);
    const target = await (signal ? abortable(finding, signal) : finding);
    signal?.throwIfAborted();
    if (target || Date.now() >= deadline) return target;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = new Promise<void>((done) => {
      timer = setTimeout(done, 250);
    });
    try {
      await (signal ? abortable(pause, signal) : pause);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The middle of a target's box, or of the element. */
export function middleOf(element: Element, target: CanvasTarget | undefined): Point {
  const r = target?.box ?? element.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
