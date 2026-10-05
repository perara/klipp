import { h } from '../../client/ui/dom.js';
import type { TokenInfo } from '../tokens.js';
import { get, send, type View } from './api.js';

export async function tokensView(): Promise<View> {
  const name = h('input', {
    'aria-label': 'Name of the app',
    placeholder: 'An app, such as square-dev',
  });
  const shown = h('div');
  const rows = h('tbody');

  async function refresh() {
    const tokens = await get<TokenInfo[]>('/ui/api/tokens');
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
                      void send('DELETE', `/ui/api/tokens/${encodeURIComponent(token.name)}`).then(
                        refresh,
                      ),
                  },
                  'Revoke',
                ),
          ),
        ),
      ),
    );
  }

  async function create() {
    const app = name.value.trim();
    try {
      const made = await send<{ token: string }>('POST', '/ui/api/tokens', { name: app });
      shown.replaceChildren(
        h(
          'div',
          { class: 'card' },
          h('p', {}, `The token for ${app}. It is shown only now:`),
          h('pre', { class: 'secret' }, made!.token),
        ),
      );
      name.value = '';
      await refresh();
    } catch (error) {
      shown.replaceChildren(
        h('p', { class: 'bad' }, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const node = h(
    'section',
    { 'aria-label': 'Tokens' },
    h(
      'form',
      { class: 'row card', onsubmit: (event: Event) => (event.preventDefault(), void create()) },
      name,
      h('button', { type: 'submit', class: 'primary' }, 'Create token'),
    ),
    shown,
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'App'), h('th', {}, 'Last used'), h('th', {}))),
      rows,
    ),
  );
  await refresh();
  return { node };
}
