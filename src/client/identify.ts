import { HOST_ATTR, formatId, instanceHash, parseId, type PathStep } from '../shared/id.js';
import { composedClosest, composedParent, deepQueryAll } from './composed.js';
import { reactAncestry, type Ancestry } from './fiber.js';

export interface Identity {
  /** The full id, or '' when nothing at or above the element was stamped by the build. */
  id: string;
  sid?: string;
  /** The nearest stamped element at or above the target, through shadow roots. */
  anchor?: Element;
  target: Element;
  /** Steps from the anchor down to the target, through markup the build did not stamp. */
  path: PathStep[];
  ancestry: Ancestry;
}

export interface Resolution {
  /** The element the id names, when it is on the page. */
  element?: Element;
  /** Every element rendered from the same code site (and instance, when the id has one). */
  candidates: Element[];
}

const selector = (sid?: string) => (sid ? `[${HOST_ATTR}="${sid}"]` : `[${HOST_ATTR}]`);

/** The nearest stamped element at or above, out through shadow roots to their hosts. */
export function anchorOf(element: Element): Element | null {
  return composedClosest(element, selector());
}

/** Without React, the stamped elements above stand in for component call sites. */
function domAncestry(anchor: Element): Ancestry {
  const callSites: string[] = [];
  const above = (el: Element) => {
    const parent = composedParent(el);
    return parent ? anchorOf(parent) : null;
  };
  for (let el = above(anchor); el; el = above(el)) callSites.push(el.getAttribute(HOST_ATTR)!);
  return { callSites, keys: [] };
}

export function ancestryOf(anchor: Element): Ancestry {
  return reactAncestry(anchor) ?? domAncestry(anchor);
}

function instanceOf(anchor: Element): string {
  const { callSites, keys } = ancestryOf(anchor);
  return instanceHash(callSites, keys);
}

function sameInstances(sid: string, instance: string | undefined, root: ParentNode): Element[] {
  const all = deepQueryAll(root as Document | Element | ShadowRoot, selector(sid));
  return instance ? all.filter((el) => instanceOf(el) === instance) : all;
}

/** The steps from `anchor` down to `target`, or undefined when it isn't below the anchor. */
function pathTo(anchor: Element, target: Element): PathStep[] | undefined {
  const path: PathStep[] = [];
  for (let el = target; el !== anchor;) {
    const parent = el.parentNode;
    if (parent instanceof ShadowRoot) {
      path.unshift('s', Array.prototype.indexOf.call(parent.children, el));
      el = parent.host;
    } else if (parent instanceof Element) {
      path.unshift(Array.prototype.indexOf.call(parent.children, el));
      el = parent;
    } else {
      return undefined;
    }
  }
  return path;
}

export function identify(target: Element, root: ParentNode = document): Identity {
  const none: Identity = { id: '', target, path: [], ancestry: { callSites: [], keys: [] } };
  const anchor = anchorOf(target);
  const path = anchor && pathTo(anchor, target);
  if (!anchor || !path) return none;
  const sid = anchor.getAttribute(HOST_ATTR)!;
  const ancestry = ancestryOf(anchor);
  const instance = instanceHash(ancestry.callSites, ancestry.keys);
  const ordinal = sameInstances(sid, instance, root).indexOf(anchor) + 1 || 1;
  return { id: formatId({ sid, instance, ordinal, path }), sid, anchor, target, path, ancestry };
}

export function resolve(text: string, root: ParentNode = document): Resolution {
  const id = parseId(text);
  if (!id) return { candidates: [] };
  const candidates = sameInstances(id.sid, id.instance, root);
  if (!id.instance) return { candidates };
  let node: Element | ShadowRoot | null | undefined = candidates[id.ordinal - 1];
  for (const step of id.path) {
    if (step === 's') node = node instanceof Element ? node.shadowRoot : undefined;
    else node = node?.children[step];
  }
  return node instanceof Element ? { element: node, candidates } : { candidates };
}
