import { isDirty, permalink, type KlippManifest, type ManifestEntry } from '../shared/manifest.js';
import type { Identity } from './identify.js';

/** Structure and state of an element. No text, no values. */
export interface Facts {
  tag: string;
  attributes: string[];
  states: string[];
  box: string;
}

const ARIA_STATES = [
  'aria-disabled',
  'aria-hidden',
  'aria-expanded',
  'aria-pressed',
  'aria-checked',
  'aria-selected',
  'aria-invalid',
  'aria-busy',
];

/**
 * @param hitTest the page element at a viewport point, looking through Klipp's own UI.
 * @param describe a short name for another element, such as `<div> 3f9a2c1d.x7k2`.
 */
export function elementFacts(
  el: Element,
  hitTest: (x: number, y: number) => Element | null,
  describe: (other: Element) => string,
): Facts {
  const attributes = ['role', 'type']
    .map((name) => [name, el.getAttribute(name)] as const)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name}="${value}"`);
  const states: string[] = [];
  if (el.matches(':disabled')) states.push('disabled');
  for (const name of ARIA_STATES) {
    const value = el.getAttribute(name);
    if (value !== null) states.push(`${name}=${value}`);
  }
  if (el.closest('[inert]')) states.push('inert');
  if (getComputedStyle(el).pointerEvents === 'none') states.push('pointer-events: none');
  const visible =
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : el.getClientRects().length > 0;
  const r = el.getBoundingClientRect();
  if (!visible) {
    states.push('not visible');
  } else if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) {
    states.push('outside the viewport');
  } else {
    const hit = hitTest(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== el && !el.contains(hit)) {
      states.push(`clicks at its centre land on ${describe(hit)}`);
    }
  }
  const box = `${Math.round(r.width)}×${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`;
  return { tag: el.localName, attributes, states, box };
}

/** The key of each query pair, skipping Klipp's own and repeats. */
function queryPairs(query: string): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const pair of query.split('&')) {
    const key = pair.split('=', 1)[0]!;
    if (!key || key === 'klipp' || seen.has(key)) continue;
    seen.add(key);
    pairs.push([key, pair]);
  }
  return pairs;
}

/** Every value blanked, except for the keys in `keep`. */
function scrubQuery(query: string, keep: readonly string[]): string {
  return queryPairs(query)
    .map(([key, pair]) => (keep.includes(key) ? pair : `${key}=…`))
    .join('&');
}

/** Only the pairs in `keep`, as they were. */
function keptQuery(query: string, keep: readonly string[]): string[] {
  return queryPairs(query)
    .filter(([key]) => keep.includes(key))
    .map(([, pair]) => pair);
}

/**
 * The page address with query values blanked; a hash route keeps its path, any other fragment
 * is blanked. `keep` names query parameters the page needs to open the same way, such as `demo`.
 */
export function redactedUrl(href: string, keep: readonly string[] = []): string {
  const url = new URL(href);
  const query = scrubQuery(url.search.slice(1), keep);
  let hash = '';
  if (url.hash.startsWith('#/')) {
    const [path, routeQuery] = url.hash.slice(1).split('?', 2);
    const scrubbed = routeQuery ? scrubQuery(routeQuery, keep) : '';
    hash = `#${path}${scrubbed ? `?${scrubbed}` : ''}`;
  } else if (url.hash) {
    hash = '#…';
  }
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}${hash}`;
}

/** A link that opens the page with the element highlighted, keeping only the query parameters in `keep`. */
export function deepLink(href: string, id: string, keep: readonly string[] = []): string {
  const url = new URL(href);
  const params = [...keptQuery(url.search.slice(1), keep), `klipp=${encodeURIComponent(id)}`];
  let route = '';
  if (url.hash.startsWith('#/')) {
    const [path, routeQuery] = url.hash.slice(1).split('?', 2);
    const kept = routeQuery ? keptQuery(routeQuery, keep) : [];
    route = `#${path}${kept.length ? `?${kept.join('&')}` : ''}`;
  }
  return `${url.origin}${url.pathname}?${params.join('&')}${route}`;
}

export function codeLabel(entry: ManifestEntry): string {
  return `${entry.file}:${entry.line}:${entry.column}`;
}

function codeLink(manifest: KlippManifest, entry: ManifestEntry): string {
  const url = permalink(manifest, entry);
  const link = url ? `[${codeLabel(entry)}](${url})` : `\`${codeLabel(entry)}\``;
  return isDirty(manifest, entry) ? `${link} (changed locally)` : link;
}

function buildLine(manifest: KlippManifest | undefined): string {
  if (!manifest?.commit) return 'unknown';
  const short = manifest.commit.slice(0, 7);
  const name = manifest.repo ? new URL(manifest.repo).pathname.slice(1) : '';
  const label = `${name}@${short}`;
  const link = manifest.repo ? `[${label}](${manifest.repo}/commit/${manifest.commit})` : label;
  return manifest.dirtyFiles?.length ? `${link}, with local changes` : link;
}

export interface FooterInput {
  identity: Identity | undefined;
  facts: Facts | undefined;
  manifest: KlippManifest | undefined;
  href: string;
  browser: string;
  keepQuery?: readonly string[];
}

/** The details Klipp appends to every issue it files: element, code, page, build, browser. */
export function issueFooter(input: FooterInput): string {
  const { identity, facts, manifest } = input;
  const lines = ['---', '', '| Klipp | |', '| --- | --- |'];
  const row = (label: string, value: string) =>
    lines.push(`| ${label} | ${value.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  const entry = identity?.sid ? manifest?.entries[identity.sid] : undefined;
  if (identity && facts) {
    const element = [`\`<${facts.tag}>\``, ...facts.attributes.map((a) => `\`${a}\``)].join(' ');
    row('Element', identity.id ? `\`${identity.id}\` ${element}` : element);
    if (manifest && entry) row('Code', codeLink(manifest, entry));
    const chain = identity.ancestry.callSites
      .map((sid) => manifest?.entries[sid])
      .filter((e): e is ManifestEntry => Boolean(e));
    if (manifest && chain.length) {
      const shown = chain.slice(0, 4).map((e) => `\`<${e.name}>\` in ${codeLink(manifest, e)}`);
      row('Rendered by', shown.join('<br>'));
    }
    if (facts.states.length) row('State', facts.states.join(', '));
  }
  row('Page', `\`${redactedUrl(input.href, input.keepQuery)}\``);
  row('Build', buildLine(manifest));
  row('Browser', input.browser);
  if (identity?.id) {
    lines.push('', `Open the element: ${deepLink(input.href, identity.id, input.keepQuery)}`);
    lines.push('', `<sub>klipp:${identity.sid}</sub>`);
  }
  return lines.join('\n');
}
