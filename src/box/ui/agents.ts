import { h } from '../../client/ui/dom.js';
import type { AgentStatus, LoginState } from '../logins.js';
import { get, listen, messageOf, send, type View } from './api.js';

/** Says in the card's panel what went wrong, where the user acted. */
const refusal = (panel: HTMLElement, text: string) =>
  panel.replaceChildren(h('p', { class: 'bad', role: 'alert' }, text));

interface Session {
  box: HTMLElement;
  stop(): void;
}

export async function agentsView(): Promise<View> {
  const cards = h('div', { class: 'agent-grid' });
  const node = h(
    'section',
    { 'aria-label': 'Agents' },
    h(
      'div',
      { class: 'section-heading' },
      h('h2', {}, 'Agents'),
      h('p', { class: 'muted' }, 'Your subscriptions. Ready for the next idea.'),
    ),
    cards,
  );
  /** The sign-ins under way, by agent: one at a time each, and their card is kept as it is. */
  const underway = new Map<string, Session>();
  let stopped = false;

  async function refresh() {
    const agents = await get<AgentStatus[]>('/ui/api/agents');
    // Card by card in place: one with a sign-in under way is the same node, so its code field
    // (and the focus in it) survive another agent's refresh.
    agents.map(card).forEach((box, at) => {
      const old = cards.children[at];
      if (!old) cards.append(box);
      else if (old !== box) old.replaceWith(box);
    });
    while (cards.children.length > agents.length) cards.lastElementChild?.remove();
  }

  function card(agent: AgentStatus): HTMLElement {
    const kept = underway.get(agent.id);
    if (kept) return kept.box;
    const panel = h('div');
    const fail = (error: unknown) => refusal(panel, messageOf(error));
    const signInButton = h(
      'button',
      {
        type: 'button',
        class: 'primary',
        onclick: () => void signIn(agent.id, box, panel, signInButton),
      },
      'Sign in',
    );
    const box = h(
      'div',
      { class: 'card agent-card', 'data-agent': agent.id },
      h(
        'div',
        { class: 'row' },
        h('h3', {}, agent.label),
        agent.signedIn
          ? h('span', { class: 'chip ok' }, 'Signed in')
          : h('span', { class: 'chip bad' }, 'Not signed in'),
      ),
      h(
        'p',
        { class: 'agent-description muted' },
        agent.id === 'claude'
          ? 'Thoughtful answers, powered by Claude Code.'
          : 'Repository insight, powered by Codex.',
      ),
      h('p', { class: 'agent-version muted' }, agent.version ?? 'Not installed'),
      agent.problem
        ? h('p', { class: 'notice bad' }, h('strong', {}, 'Needs attention · '), agent.problem)
        : h(
            'p',
            { class: 'muted' },
            agent.signedIn
              ? 'Ready to work in the repository.'
              : 'Sign in with your subscription to get started.',
          ),
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
          : signInButton,
      ),
      panel,
    );
    return box;
  }

  /** One sign-in at a time for an agent: its button goes while one is under way. */
  async function signIn(
    id: string,
    box: HTMLElement,
    panel: HTMLElement,
    button: HTMLButtonElement,
  ) {
    underway.get(id)?.stop();
    // Marked at the click, so no refresh replaces the card while the box starts the sign-in.
    const session: Session = { box, stop: () => undefined };
    underway.set(id, session);
    button.hidden = true;
    const leave = () => {
      session.stop();
      if (underway.get(id) === session) underway.delete(id);
    };
    const end = (text: string) => {
      leave();
      button.hidden = false;
      refusal(panel, text);
    };
    try {
      const started = await send<{ login: string }>('POST', `/ui/api/agents/${id}/login`);
      if (stopped) return;
      const login = started!.login;
      panel.replaceChildren(h('p', { class: 'muted' }, 'Starting…'));
      session.stop = listen<LoginState>(
        `/ui/api/logins/${login}`,
        (state) => {
          if (state.state === 'waiting') panel.replaceChildren(...waiting(login, state));
          if (state.state === 'failed') end(state.message);
          if (state.state === 'done') {
            leave();
            panel.replaceChildren();
            refresh().catch((error) => end(messageOf(error)));
          }
        },
        () => end('The sign-in stream ended.'),
      );
    } catch (error) {
      end(messageOf(error));
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
      const input = h('input', {
        id: `login-code-${login}`,
        'aria-label': 'Code from the sign-in page',
        autocomplete: 'off',
      });
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
          h('label', { for: `login-code-${login}` }, 'Code from the sign-in page'),
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
  return {
    node,
    stop() {
      stopped = true;
      underway.forEach((session) => session.stop());
    },
  };
}
