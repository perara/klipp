import { HOST_ATTR } from '../shared/id.js';
import { isDirty, permalink, type KlippManifest } from '../shared/manifest.js';
import type { ElementContext, ElementRef, PageContext } from '../shared/protocol.js';
import { failedRequests, recentErrors } from './capture.js';
import { anchorOf, identify } from './identify.js';
import { elementFacts, redactedUrl } from './report.js';

export interface Probe {
  /** The page element at a point, looking through Klipp's own UI. */
  hitTest: (x: number, y: number) => Element | null;
  /** Page elements under a point, topmost first, leaving out Klipp's own UI. */
  elementsAt: (x: number, y: number) => Element[];
}

export function elementRef(element: Element, manifest: KlippManifest | undefined): ElementRef {
  const sid = anchorOf(element)?.getAttribute(HOST_ATTR);
  const owner = sid ? manifest?.entries[sid]?.owner : undefined;
  return {
    id: identify(element).id,
    tag: element.localName,
    ...(owner ? { component: owner } : {}),
  };
}

const describe = (element: Element) => {
  const { id } = identify(element);
  return id ? `<${element.localName}> ${id}` : `<${element.localName}>`;
};

/** What the model is told about an element, picked at `point` (its centre when not given). */
export function elementContext(
  element: Element,
  manifest: KlippManifest | undefined,
  probe: Probe,
  point?: { x: number; y: number },
): ElementContext {
  const identity = identify(element);
  const facts = elementFacts(element, probe.hitTest, describe);
  const entry = identity.sid ? manifest?.entries[identity.sid] : undefined;
  const r = element.getBoundingClientRect();
  const at = point ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const stack = probe.elementsAt(at.x, at.y);
  const below = stack.indexOf(element) >= 0 ? stack.slice(stack.indexOf(element) + 1) : stack;
  const parent = identity.anchor?.parentElement ? anchorOf(identity.anchor.parentElement) : null;
  const url = manifest && entry ? permalink(manifest, entry) : undefined;
  return {
    id: identity.id,
    tag: facts.tag,
    attributes: facts.attributes,
    states: facts.states,
    box: facts.box,
    ...(entry
      ? {
          code: {
            file: entry.file,
            line: entry.line,
            column: entry.column,
            component: entry.owner,
            ...(url ? { permalink: url } : {}),
            ...(manifest && isDirty(manifest, entry) ? { changedLocally: true } : {}),
          },
        }
      : {}),
    renderedBy: identity.ancestry.callSites.slice(0, 8).flatMap((sid) => {
      const site = manifest?.entries[sid];
      return site
        ? [{ component: site.name, usedIn: site.owner, file: site.file, line: site.line }]
        : [];
    }),
    ...(identity.path.length ? { unstampedPath: identity.path.join('/') } : {}),
    ...(parent ? { parent: elementRef(parent, manifest) } : {}),
    beneath: below
      .filter((el) => el !== document.body)
      .slice(0, 3)
      .map((el) => elementRef(el, manifest)),
  };
}

export function pageContext(keepQuery: readonly string[], element?: ElementContext): PageContext {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    url: redactedUrl(location.href, keepQuery),
    viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    colorScheme: dark ? 'dark' : 'light',
    userAgent: navigator.userAgent,
    recentErrors: recentErrors(),
    failedRequests: failedRequests(),
    ...(element ? { element } : {}),
  };
}
