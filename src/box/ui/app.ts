import { h } from '../../client/ui/dom.js';
import { agentsView } from './agents.js';
import type { View } from './api.js';
import { runsView } from './runs.js';
import { CSS } from './styles.js';
import { tokensView } from './tokens.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(CSS);
document.adoptedStyleSheets = [sheet];

const SECTIONS = { agents: 'Agents', tokens: 'Tokens', runs: 'Runs' } as const;
type Section = keyof typeof SECTIONS;
const isSection = (value: string): value is Section => Object.hasOwn(SECTIONS, value);

const main = h('main');
const links = (Object.keys(SECTIONS) as Section[]).map((section) =>
  h('a', { href: `#${section}`, 'data-section': section }, SECTIONS[section]),
);
document.body.append(
  h('header', {}, h('h1', {}, 'AI box'), h('nav', { 'aria-label': 'Sections' }, ...links)),
  main,
);

let current: View | undefined;
async function show() {
  const [first = '', id] = location.hash.slice(1).split('/');
  const section: Section = isSection(first) ? first : 'agents';
  for (const link of links) {
    if (link.dataset.section === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  current?.stop?.();
  try {
    current =
      section === 'agents'
        ? await agentsView()
        : section === 'tokens'
          ? await tokensView()
          : await runsView(id);
    main.replaceChildren(current.node);
  } catch (error) {
    main.replaceChildren(
      h('p', { class: 'bad' }, error instanceof Error ? error.message : String(error)),
    );
  }
}
addEventListener('hashchange', () => void show());
void show();
