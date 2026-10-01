import { isDirty, permalink, type KlippManifest, type ManifestEntry } from '../shared/manifest.js';
import type { Identity } from './identify.js';

/** What the report says about the element. Structure and state only: no text, no values. */
export interface Facts {
  tag: string;
  attributes: string[];
  states: string[];
  box: string;
}

export interface ReportEnv {
  href: string;
  userAgent: string;
  viewport: string;
  colorScheme: string;
}

export interface ReportInput {
  identity: Identity;
  manifest: KlippManifest | undefined;
  facts: Facts;
  note: string;
  /** Only when the reporter opted in: the element's visible text and labels. */
  text?: string[];
  env: ReportEnv;
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
 * @param hitTest the page element at a viewport point, ignoring Klipp's own UI.
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
  const style = getComputedStyle(el);
  if (style.pointerEvents === 'none') states.push('pointer-events: none');
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

/** Labels and visible text. Never form values. */
export function visibleText(el: Element): string[] {
  const out: string[] = [];
  for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
    const value = el.getAttribute(name);
    if (value) out.push(`${name}: ${value}`);
  }
  if (!el.matches('input, textarea, select')) {
    const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text) out.push(text.length > 280 ? `${text.slice(0, 279)}…` : text);
  }
  return out;
}

function scrubQuery(query: string): string {
  const keys = new Set(
    query
      .split('&')
      .map((pair) => pair.split('=', 1)[0]!)
      .filter((key) => key && key !== 'klipp'),
  );
  return [...keys].map((key) => `${key}=…`).join('&');
}

/** The page address with query values blanked; a hash route keeps its path, any other fragment is blanked. */
export function redactedUrl(href: string): string {
  const url = new URL(href);
  const query = scrubQuery(url.search.slice(1));
  let hash = '';
  if (url.hash.startsWith('#/')) {
    const [path, routeQuery] = url.hash.slice(1).split('?', 2);
    const scrubbed = routeQuery ? scrubQuery(routeQuery) : '';
    hash = `#${path}${scrubbed ? `?${scrubbed}` : ''}`;
  } else if (url.hash) {
    hash = '#…';
  }
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}${hash}`;
}

/** A link that opens the page with the element highlighted. */
export function deepLink(href: string, id: string): string {
  const url = new URL(href);
  const route = url.hash.startsWith('#/') ? `#${url.hash.slice(1).split('?', 1)[0]}` : '';
  return `${url.origin}${url.pathname}?klipp=${encodeURIComponent(id)}${route}`;
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

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}text\n${text}\n${marks}`;
}

export function buildReport(input: ReportInput): string {
  const { identity, manifest, facts, env } = input;
  const entry = identity.sid ? manifest?.entries[identity.sid] : undefined;
  const lines: string[] = [];
  const tag = `\`<${facts.tag}>\``;
  lines.push(`### Klipp: ${entry ? `${tag} in \`${entry.owner}\`` : tag}`, '');
  const note = input.note.trim();
  if (note) lines.push(...note.split('\n').map((line) => `> ${line}`), '');

  lines.push('| | |', '| --- | --- |');
  const row = (label: string, value: string) => lines.push(`| ${label} | ${cell(value)} |`);
  const element = [tag, ...facts.attributes.map((a) => `\`${a}\``)].join(' ');
  row(
    'Element',
    identity.id ? `\`${identity.id}\` ${element}` : `${element}, not in the app's own code`,
  );
  if (manifest && entry) row('Code', codeLink(manifest, entry));
  if (identity.path.length)
    row('Inside', `markup the build did not stamp, child path \`${identity.path.join('/')}\``);
  const chain = identity.ancestry.callSites
    .map((sid) => manifest?.entries[sid])
    .filter((e): e is ManifestEntry => Boolean(e));
  if (manifest && chain.length) {
    const shown = chain.slice(0, 6).map((e) => `\`<${e.name}>\` in ${codeLink(manifest, e)}`);
    if (chain.length > 6) shown.push(`and ${chain.length - 6} more`);
    row('Rendered by', shown.join('<br>'));
  }
  if (facts.states.length) row('State', facts.states.join(', '));
  row('Box', facts.box);
  row('Page', `\`${redactedUrl(env.href)}\``);
  row('Build', buildLine(manifest));
  row('Browser', `${env.userAgent}<br>${env.viewport}, ${env.colorScheme}`);

  if (input.text?.length) {
    lines.push(
      '',
      '<details><summary>Element text, included by the reporter</summary>',
      '',
      fence(input.text.join('\n')),
      '',
      '</details>',
    );
  }
  if (identity.id) {
    lines.push('', `Open the element: ${deepLink(env.href, identity.id)}`);
    lines.push('', `<sub>klipp:${identity.sid}</sub>`);
  }
  return lines.join('\n');
}
