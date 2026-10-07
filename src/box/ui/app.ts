import { h } from '../../client/ui/dom.js';
import { agentsView } from './agents.js';
import { get, messageOf, type View } from './api.js';
import { MASCOT } from './brand.js';
import { runsView } from './runs.js';
import { CSS } from './styles.js';
import { tokensView } from './tokens.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(CSS);
document.adoptedStyleSheets = [sheet];

const SECTIONS = { agents: 'Agents', tokens: 'Tokens', runs: 'Runs' } as const;
type Section = keyof typeof SECTIONS;
const isSection = (value: string): value is Section => Object.hasOwn(SECTIONS, value);

const main = h('main', { id: 'workspace', tabindex: '-1' });
const identity = h('span', { class: 'identity', role: 'status' }, 'Checking session…');
const descriptions = {
  agents: 'Sign in & check readiness',
  tokens: 'Connect your apps',
  runs: 'Follow the work',
};
const links = (Object.keys(SECTIONS) as Section[]).map((section, index) =>
  h(
    'a',
    { href: `#${section}`, 'data-section': section, class: 'section-link' },
    h('span', { class: 'nav-number', 'aria-hidden': 'true' }, `0${index + 1}`),
    h(
      'span',
      {},
      h('strong', {}, SECTIONS[section]),
      h('span', { class: 'nav-description' }, descriptions[section]),
    ),
    h('span', { class: 'nav-arrow', 'aria-hidden': 'true' }, '↗'),
  ),
);
document.body.append(
  h('a', { class: 'skip', href: '#workspace' }, 'Skip to workspace'),
  h(
    'header',
    {},
    h(
      'a',
      { class: 'brand', href: '#agents', 'aria-label': 'Smia home' },
      h('img', { src: MASCOT, alt: '', width: '40', height: '60' }),
      h('span', {}, h('strong', {}, 'Smia'), h('span', { class: 'brand-byline' }, 'by Klipp')),
    ),
    identity,
  ),
  h(
    'div',
    { class: 'shell' },
    h(
      'div',
      { class: 'intro' },
      h(
        'div',
        {},
        h('p', { class: 'eyebrow' }, 'THE FORGE'),
        h('h1', {}, 'Where Klipp’s agents work.'),
        h(
          'p',
          { class: 'muted' },
          'Keep your agents ready, connect your apps, and watch ideas take shape.',
        ),
      ),
      h('span', { class: 'forge-mark', 'aria-hidden': 'true' }, 'S'),
    ),
    h('nav', { 'aria-label': 'Sections' }, ...links),
    main,
    h('footer', {}, 'Smia means “the forge”. A home for the agents behind Klipp.'),
  ),
);
void get<{ user: string | null }>('/ui/api/session').then(
  ({ user }) => {
    identity.textContent = user ? `Signed in as ${user}` : 'Local workspace';
  },
  (error) => {
    identity.textContent = messageOf(error);
    identity.classList.add('bad');
  },
);

let current: View | undefined;
/** Counts the route changes, so only the latest one may put its view on the page. */
let latest = 0;
async function show() {
  const [first = '', id] = location.hash.slice(1).split('/');
  if (first === 'workspace') return;
  const mine = ++latest;
  const section: Section = isSection(first) ? first : 'agents';
  for (const link of links) {
    if (link.dataset.section === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  current?.stop?.();
  current = undefined;
  try {
    const view =
      section === 'agents'
        ? await agentsView()
        : section === 'tokens'
          ? await tokensView()
          : await runsView(id);
    // A newer change came while this view was being built: it is not wanted any more.
    if (mine !== latest) return view.stop?.();
    current = view;
    main.replaceChildren(view.node);
  } catch (error) {
    if (mine === latest)
      main.replaceChildren(h('p', { class: 'card bad', role: 'alert' }, messageOf(error)));
  }
}
addEventListener('hashchange', () => void show());
void show();
