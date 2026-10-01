import { CALL_SITE_PROP } from '../shared/id.js';

/** The few fields of a React fiber Klipp reads. They are the same in development and production builds. */
interface Fiber {
  key: unknown;
  type: unknown;
  memoizedProps?: unknown;
  return: Fiber | null;
}

export interface Ancestry {
  /** Sids of the component call sites that led to the element, nearest first. */
  callSites: string[];
  /** React keys on the way up, nearest first. */
  keys: string[];
}

export function fiberOf(element: Element): Fiber | undefined {
  for (const key of Object.keys(element)) {
    if (key.startsWith('__reactFiber$')) {
      return (element as unknown as Record<string, Fiber>)[key];
    }
  }
  return undefined;
}

export function reactAncestry(element: Element): Ancestry | undefined {
  let fiber = fiberOf(element) ?? null;
  if (!fiber) return undefined;
  const callSites: string[] = [];
  const keys: string[] = [];
  for (; fiber; fiber = fiber.return) {
    if (fiber.key !== null && fiber.key !== undefined) keys.push(String(fiber.key));
    if (typeof fiber.type === 'string') continue;
    const props = fiber.memoizedProps;
    const site =
      typeof props === 'object' && props !== null
        ? (props as Record<string, unknown>)[CALL_SITE_PROP]
        : undefined;
    // memo() and friends add a second fiber with the same props.
    if (typeof site === 'string' && site !== callSites.at(-1)) callSites.push(site);
  }
  return { callSites, keys };
}
