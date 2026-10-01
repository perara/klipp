import {
  isDirty,
  permalink,
  type KlippManifest,
  type ManifestEntry,
} from '../../shared/manifest.js';
import type { Identity } from '../identify.js';
import { codeLabel, type Facts } from '../report.js';
import { character } from './character.js';
import { h } from './dom.js';

export interface Draft {
  note: string;
  includeText: boolean;
}

export interface PanelProps {
  identity: Identity;
  manifest: KlippManifest | undefined;
  facts: Facts;
  /** Kept across re-renders when the selection moves to the parent or beneath. */
  draft: Draft;
  linked: boolean;
  canOpenInEditor: boolean;
  hasParent: boolean;
  hasBeneath: boolean;
  copyReport(): Promise<boolean>;
  copyLink(): Promise<boolean>;
  copyId(): Promise<boolean>;
  openInEditor(entry: ManifestEntry): void;
  parent(): void;
  beneath(): void;
  pickAgain(): void;
  close(): void;
}

let panelCount = 0;

function codeLine(props: PanelProps, entry: ManifestEntry, withEditor = false) {
  const { manifest } = props;
  const url = manifest && permalink(manifest, entry);
  const label = codeLabel(entry);
  return h(
    'span',
    {},
    url
      ? h('a', { href: url, target: '_blank', rel: 'noreferrer', class: 'mono' }, label)
      : h('span', { class: 'mono' }, label),
    withEditor &&
      props.canOpenInEditor &&
      h(
        'button',
        { class: 'btn link', type: 'button', onclick: () => props.openInEditor(entry) },
        'Open in editor',
      ),
  );
}

function title(identity: Identity, facts: Facts, entry: ManifestEntry | undefined): string {
  const tag = `<${facts.tag}>`;
  if (!entry) return tag;
  if (identity.path.length) return `${tag} inside <${entry.name}> in ${entry.owner}`;
  return `${tag} in ${entry.owner}`;
}

export function renderPanel(props: PanelProps): HTMLElement {
  const { identity, manifest, facts, draft } = props;
  const entry = identity.sid ? manifest?.entries[identity.sid] : undefined;
  const headingId = `klipp-panel-${++panelCount}`;
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const say = (text: string) => {
    status.textContent = text;
  };
  const copying = (copy: () => Promise<boolean>, done: string) => async () =>
    say((await copy()) ? done : "Couldn't reach the clipboard.");

  const rows: Array<[string, Node | string]> = [];
  if (entry) {
    rows.push(['Code', codeLine(props, entry, true)]);
  }
  const chain = identity.ancestry.callSites
    .map((sid) => manifest?.entries[sid])
    .filter((e): e is ManifestEntry => Boolean(e));
  if (chain.length) {
    const items = chain
      .slice(0, 4)
      .map((e) =>
        h('li', {}, h('code', {}, `<${e.name}>`), ` in ${e.owner} · `, codeLine(props, e)),
      );
    if (chain.length > 4) items.push(h('li', { class: 'small' }, `and ${chain.length - 4} more`));
    rows.push(['Rendered by', h('ol', {}, ...items)]);
  }
  rows.push([
    'State',
    facts.states.length
      ? h('div', { class: 'chips' }, ...facts.states.map((s) => h('span', { class: 'chip' }, s)))
      : h('span', { class: 'small' }, 'Nothing unusual'),
  ]);

  const warnings: string[] = [];
  if (!identity.id)
    warnings.push(
      "This element isn't in the app's own code: nothing above it was stamped by the build.",
    );
  if (!manifest) warnings.push("Couldn't load the Klipp manifest, so code locations are unknown.");
  else if (!manifest.repo || !manifest.commit)
    warnings.push('No git remote or commit was found, so there are no GitHub links.');
  if (manifest && entry && isDirty(manifest, entry)) {
    warnings.push('This file has local changes; the GitHub link may point at other lines.');
  }

  const note = h('textarea', {
    placeholder: 'What looks wrong? (optional)',
    'aria-label': 'What looks wrong?',
  });
  note.value = draft.note;
  note.addEventListener('input', () => {
    draft.note = note.value;
  });
  const includeText = h('input', { type: 'checkbox' });
  includeText.checked = draft.includeText;
  includeText.addEventListener('change', () => {
    draft.includeText = includeText.checked;
  });

  return h(
    'section',
    { class: 'panel', role: 'dialog', 'aria-labelledby': headingId },
    h(
      'header',
      {},
      character(),
      h(
        'div',
        {},
        h('h2', { id: headingId }, `Klipp: ${title(identity, facts, entry)}`),
        identity.id &&
          h(
            'div',
            { class: 'id-row' },
            h('code', { class: 'id', 'data-testid': 'klipp-id' }, identity.id),
            h(
              'button',
              { class: 'btn link', type: 'button', onclick: copying(props.copyId, 'ID copied.') },
              'Copy ID',
            ),
          ),
        props.linked && h('div', { class: 'small' }, 'Opened from a Klipp link.'),
      ),
      h(
        'button',
        { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => props.close() },
        '×',
      ),
    ),
    h(
      'div',
      { class: 'body' },
      h('dl', {}, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
      ...warnings.map((w) => h('div', { class: 'warning' }, w)),
      note,
      h(
        'label',
        { class: 'opt' },
        includeText,
        h(
          'span',
          {},
          "Include the element's text",
          h(
            'div',
            { class: 'small' },
            'Off by default, so what is on screen stays out of reports.',
          ),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: copying(props.copyReport, 'Report copied. Paste it into a GitHub issue.'),
          },
          'Copy report',
        ),
        identity.id &&
          h(
            'button',
            { class: 'btn', type: 'button', onclick: copying(props.copyLink, 'Link copied.') },
            'Copy link',
          ),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: !props.hasParent,
            onclick: () => props.parent(),
          },
          '↑ Parent',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: !props.hasBeneath,
            onclick: () => props.beneath(),
          },
          'Beneath',
        ),
        h(
          'button',
          { class: 'btn', type: 'button', onclick: () => props.pickAgain() },
          'Pick another',
        ),
      ),
      status,
    ),
  );
}
