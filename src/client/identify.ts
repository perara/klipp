import { HOST_ATTR, formatId, instanceHash, parseId } from '../shared/id.js';
import { reactAncestry, type Ancestry } from './fiber.js';

export interface Identity {
  /** The full id, or '' when nothing at or above the element was stamped by the build. */
  id: string;
  sid?: string;
  /** The nearest stamped element at or above the target. */
  anchor?: Element;
  target: Element;
  /** Child indices from the anchor down to the target, through markup the build did not stamp. */
  path: number[];
  ancestry: Ancestry;
}

export interface Resolution {
  /** The element the id names, when it is on the page. */
  element?: Element;
  /** Every element rendered from the same code site (and instance, when the id has one). */
  candidates: Element[];
}

const selector = (sid?: string) => (sid ? `[${HOST_ATTR}="${sid}"]` : `[${HOST_ATTR}]`);

export function anchorOf(element: Element): Element | null {
  return element.closest(selector());
}

/** Without React, the stamped elements above stand in for component call sites. */
function domAncestry(anchor: Element): Ancestry {
  const callSites: string[] = [];
  for (
    let el = anchor.parentElement?.closest(selector());
    el;
    el = el.parentElement?.closest(selector())
  ) {
    callSites.push(el.getAttribute(HOST_ATTR)!);
  }
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
  const all = Array.from(root.querySelectorAll(selector(sid)));
  return instance ? all.filter((el) => instanceOf(el) === instance) : all;
}

const childIndex = (el: Element) => Array.prototype.indexOf.call(el.parentElement!.children, el);

export function identify(target: Element, root: ParentNode = document): Identity {
  const anchor = anchorOf(target);
  if (!anchor) return { id: '', target, path: [], ancestry: { callSites: [], keys: [] } };
  const sid = anchor.getAttribute(HOST_ATTR)!;
  const ancestry = ancestryOf(anchor);
  const instance = instanceHash(ancestry.callSites, ancestry.keys);
  const ordinal = sameInstances(sid, instance, root).indexOf(anchor) + 1 || 1;
  const path: number[] = [];
  for (let el = target; el !== anchor; el = el.parentElement!) path.unshift(childIndex(el));
  return { id: formatId({ sid, instance, ordinal, path }), sid, anchor, target, path, ancestry };
}

export function resolve(text: string, root: ParentNode = document): Resolution {
  const id = parseId(text);
  if (!id) return { candidates: [] };
  const candidates = sameInstances(id.sid, id.instance, root);
  if (!id.instance) return { candidates };
  let element: Element | undefined = candidates[id.ordinal - 1];
  for (const index of id.path) element = element?.children[index];
  return element ? { element, candidates } : { candidates };
}
