import { h } from '../../client/ui/dom.js';
import type { TokenInfo } from '../tokens.js';
import { get, messageOf, send, type View } from './api.js';

export async function tokensView(): Promise<View> {
  const name = h('input', {
    id: 'app-name',
    'aria-label': 'Name of the app',
    required: '',
    maxlength: '40',
    placeholder: 'An app, such as square-dev',
  });
  const shown = h('div');
  /** The app whose new token is on show, until that token is revoked. */
  let shownFor: string | undefined;
  // What the box refused, apart from `shown` so a refusal never wipes a token not yet copied.
  const refused = h('div', { class: 'bad', role: 'alert' });
  const rows = h('tbody');
  const empty = h(
    'p',
    { class: 'empty muted' },
    'No tokens yet. Create one to connect your first app.',
  );

  async function refresh() {
    const tokens = await get<TokenInfo[]>('/ui/api/tokens');
    // A revoked token's secret is of no use: it goes, whoever revoked it.
    if (shownFor && !tokens.some((token) => token.name === shownFor)) {
      shown.replaceChildren();
      shownFor = undefined;
    }
    empty.hidden = tokens.length > 0;
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
      'div',
      { class: 'section-heading' },
      h('h2', {}, 'Tokens'),
      h('p', { class: 'muted' }, 'A private key for each app. Shown once, stored hashed.'),
    ),
    h(
      'form',
      {
        class: 'token-form card',
        onsubmit: (event: Event) => (event.preventDefault(), void act(create)),
      },
      h('label', { for: 'app-name' }, 'Name of the app'),
      h(
        'div',
        { class: 'row' },
        name,
        h('button', { type: 'submit', class: 'primary' }, 'Create token'),
      ),
    ),
    shown,
    refused,
    h(
      'div',
      { class: 'card table-card' },
      empty,
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
    ),
  );
  await refresh();
  return { node };
}
