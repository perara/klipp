import { h } from '../../client/ui/dom.js';
import type { TokenInfo } from '../tokens.js';
import { get, messageOf, send, type View } from './api.js';

export async function tokensView(): Promise<View> {
  const name = h('input', {
    'aria-label': 'Name of the app',
    placeholder: 'An app, such as square-dev',
  });
  const shown = h('div');
  /** The app whose new token is on show, until that token is revoked. */
  let shownFor: string | undefined;
  // What the box refused, apart from `shown` so a refusal never wipes a token not yet copied.
  const refused = h('div', { class: 'bad', role: 'alert' });
  const rows = h('tbody');

  async function refresh() {
    const tokens = await get<TokenInfo[]>('/ui/api/tokens');
    // A revoked token's secret is of no use: it goes, whoever revoked it.
    if (shownFor && !tokens.some((token) => token.name === shownFor)) {
      shown.replaceChildren();
      shownFor = undefined;
    }
    rows.replaceChildren(
      ...tokens.map((token) =>
        h(
          'tr',
          {},
          h('td', {}, token.name),
          h(
            'td',
            { class: 'muted' },
            token.lastUsed ? `used ${new Date(token.lastUsed).toLocaleString()}` : 'never used',
          ),
          h(
            'td',
            {},
            token.fromEnv
              ? h('span', { class: 'muted' }, 'from environment')
              : h(
                  'button',
                  {
                    type: 'button',
                    onclick: () =>
                      void act(() =>
                        send('DELETE', `/ui/api/tokens/${encodeURIComponent(token.name)}`),
                      ),
                  },
                  'Revoke',
                ),
          ),
        ),
      ),
    );
  }

  /** Runs what the user asked for, shows a refusal, and reads the list again either way. */
  async function act(action: () => Promise<unknown>) {
    refused.textContent = '';
    try {
      await action();
    } catch (error) {
      refused.textContent = messageOf(error);
    }
    try {
      await refresh();
    } catch (error) {
      refused.textContent = messageOf(error);
    }
  }

  async function create() {
    const app = name.value.trim();
    const made = await send<{ token: string }>('POST', '/ui/api/tokens', { name: app });
    shown.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('p', {}, `The token for ${app}. It is shown only now:`),
        h('pre', { class: 'secret' }, made!.token),
      ),
    );
    shownFor = app;
    name.value = '';
  }

  const node = h(
    'section',
    { 'aria-label': 'Tokens' },
    h(
      'form',
      { class: 'row card', onsubmit: (event: Event) => (event.preventDefault(), void act(create)) },
      name,
      h('button', { type: 'submit', class: 'primary' }, 'Create token'),
    ),
    shown,
    refused,
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, 'App'), h('th', {}, 'Last used'), h('th', {}, 'Action')),
      ),
      rows,
    ),
  );
  await refresh();
  return { node };
}
