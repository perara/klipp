import { h } from '../../client/ui/dom.js';
import type { AgentStatus, LoginState } from '../logins.js';
import { get, listen, messageOf, send, type View } from './api.js';

/** Says in the card's panel what went wrong, where the user acted. */
const refusal = (panel: HTMLElement, text: string) =>
  panel.replaceChildren(h('p', { class: 'bad', role: 'alert' }, text));

export async function agentsView(): Promise<View> {
  const node = h('section', { 'aria-label': 'Agents' });
  const stops = new Set<() => void>();

  async function refresh() {
    const agents = await get<AgentStatus[]>('/ui/api/agents');
    node.replaceChildren(...agents.map(card));
  }

  function card(agent: AgentStatus): HTMLElement {
    const panel = h('div');
    const fail = (error: unknown) => refusal(panel, messageOf(error));
    const box = h(
      'div',
      { class: 'card', 'data-agent': agent.id },
      h(
        'div',
        { class: 'row' },
        h('strong', {}, agent.label),
        agent.signedIn
          ? h('span', { class: 'ok' }, 'Signed in')
          : h('span', { class: 'bad' }, 'Not signed in'),
        h('span', { class: 'muted' }, agent.version ?? 'not installed'),
      ),
      agent.problem ? h('p', { class: 'bad' }, agent.problem) : null,
      h(
        'div',
        { class: 'row' },
        agent.signedIn
          ? h(
              'button',
              {
                type: 'button',
                onclick: () =>
                  void send('POST', `/ui/api/agents/${agent.id}/logout`).then(refresh).catch(fail),
              },
              'Sign out',
            )
          : h(
              'button',
              { type: 'button', class: 'primary', onclick: () => void signIn(agent, panel) },
              'Sign in',
            ),
      ),
      panel,
    );
    return box;
  }

  async function signIn(agent: AgentStatus, panel: HTMLElement) {
    try {
      const started = await send<{ login: string }>('POST', `/ui/api/agents/${agent.id}/login`);
      const login = started!.login;
      panel.replaceChildren(h('p', { class: 'muted' }, 'Starting…'));
      const stop = listen<LoginState>(
        `/ui/api/logins/${login}`,
        (state, close) => {
          if (state.state === 'waiting') panel.replaceChildren(...waiting(login, state));
          if (state.state === 'done') {
            close();
            refresh().catch((error) => refusal(panel, messageOf(error)));
          }
          if (state.state === 'failed') {
            close();
            refusal(panel, state.message);
          }
        },
        () => refusal(panel, 'Lost the connection to the box.'),
      );
      stops.add(stop);
    } catch (error) {
      refusal(panel, messageOf(error));
    }
  }

  function waiting(login: string, state: Extract<LoginState, { state: 'waiting' }>): Node[] {
    // Where a refused code or cancel says so, with the form and the button still there to retry.
    const refused = h('div', { class: 'bad', role: 'alert' });
    const attempt = (action: () => Promise<unknown>) => {
      refused.textContent = '';
      action().catch((error) => {
        refused.textContent = messageOf(error);
      });
    };
    const nodes: Node[] = [
      h(
        'p',
        {},
        'Open this link and sign in: ',
        h('a', { href: state.url, target: '_blank', rel: 'noopener noreferrer' }, state.url),
      ),
    ];
    if (state.code) nodes.push(h('p', {}, 'Enter this code there: ', h('code', {}, state.code)));
    if (state.needsCode) {
      const input = h('input', { 'aria-label': 'Code from the sign-in page', autocomplete: 'off' });
      nodes.push(
        h(
          'form',
          {
            class: 'row',
            onsubmit: (event: Event) => {
              event.preventDefault();
              attempt(() =>
                send('POST', `/ui/api/logins/${login}/code`, { code: input.value.trim() }),
              );
            },
          },
          input,
          h('button', { type: 'submit', class: 'primary' }, 'Send code'),
        ),
      );
    }
    nodes.push(
      h(
        'button',
        { type: 'button', onclick: () => attempt(() => send('DELETE', `/ui/api/logins/${login}`)) },
        'Cancel',
      ),
      refused,
    );
    return nodes;
  }

  await refresh();
  return { node, stop: () => stops.forEach((stop) => stop()) };
}
