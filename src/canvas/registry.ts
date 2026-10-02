/** A box in viewport pixels, as `getBoundingClientRect` gives it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Facts for the agent: short values, no free text. */
export type Details = Record<string, string | number | boolean>;

/** Something drawn on a canvas that a user can point at: a map feature, a 3D object. */
export interface CanvasTarget {
  /**
   * Names it on this canvas, the same on every load, so a link can bring it back: such as
   * `incidents:42` for a map feature, or a scene path for a 3D object.
   */
  key: string;
  /** For people: `Polygon 7 in layer search-areas`, `Mesh "Crate"`. */
  label: string;
  details?: Details;
  /** The source id of the JSX that made it, as on `data-klipp`, for react-three-fiber objects. */
  sid?: string;
  /** Where it is on screen now, in viewport pixels. */
  box?: Box;
}

/** Tells Klipp what a canvas draws. */
export interface CanvasAdapter {
  /** What is drawn at a viewport point on `canvas`, the topmost thing; undefined for nothing. */
  at(point: Point, canvas: Element): CanvasTarget | undefined;
  /** Finds what `key` names, if it is drawn now, for following a link. */
  find?(key: string, canvas: Element): CanvasTarget | undefined | Promise<CanvasTarget | undefined>;
}

const REGISTRY = Symbol.for('klipp.canvases');

/**
 * On the global object, so one registry serves every copy of this module: the app's own
 * import and Klipp's runtime may be bundled apart. Weak, so a canvas that goes away is let go.
 */
function registry(): WeakMap<Element, CanvasAdapter> {
  const global = globalThis as { [REGISTRY]?: WeakMap<Element, CanvasAdapter> };
  return (global[REGISTRY] ??= new WeakMap());
}

/**
 * Tells Klipp what is drawn on a canvas, or in an element that holds one, so a user can point
 * at a map feature or a 3D object rather than at the canvas. Cheap and inert where Klipp
 * isn't running. Returns a function that undoes it.
 */
export function registerCanvas(element: Element, adapter: CanvasAdapter): () => void {
  registry().set(element, adapter);
  return () => {
    if (registry().get(element) === adapter) registry().delete(element);
  };
}

/** The adapter for an element: its own, or one registered on an element around it. */
export function canvasAdapterFor(
  element: Element,
): { canvas: Element; adapter: CanvasAdapter } | undefined {
  const adapters = registry();
  for (let node: Element | null = element; node;) {
    const adapter = adapters.get(node);
    if (adapter) return { canvas: node, adapter };
    const parent: Node | null = node.parentNode;
    node = parent instanceof Element ? parent : parent instanceof ShadowRoot ? parent.host : null;
  }
  return undefined;
}
