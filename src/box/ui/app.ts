import { h } from '../../client/ui/dom.js';
import { agentsView } from './agents.js';
import { messageOf, type View } from './api.js';
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
/** Counts the route changes, so only the latest one may put its view on the page. */
let latest = 0;
async function show() {
  const mine = ++latest;
  const [first = '', id] = location.hash.slice(1).split('/');
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
    if (mine === latest) main.replaceChildren(h('p', { class: 'bad' }, messageOf(error)));
  }
}
addEventListener('hashchange', () => void show());
void show();
