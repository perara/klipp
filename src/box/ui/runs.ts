import { h } from '../../client/ui/dom.js';
import type { RunLine, RunSummary } from '../runlog.js';
import { get, listen, type View } from './api.js';

export async function runsView(id: string | undefined): Promise<View> {
  return id ? runView(id) : listView();
}

async function listView(): Promise<View> {
  const runs = await get<RunSummary[]>('/ui/api/runs');
  const node = h('section', { 'aria-label': 'Runs' });
  if (!runs.length) node.append(h('p', { class: 'muted' }, 'No runs yet.'));
  else
    node.append(
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Started'),
            h('th', {}, 'App'),
            h('th', {}, 'Agent'),
            h('th', {}, 'Outcome'),
          ),
        ),
        h(
          'tbody',
          {},
          ...runs.map((run) =>
            h(
              'tr',
              {},
              h(
                'td',
                {},
                h('a', { href: `#runs/${run.id}` }, new Date(run.started).toLocaleString()),
              ),
              h('td', {}, run.app),
              h('td', {}, run.agent),
              h(
                'td',
                { class: run.live ? 'muted' : run.outcome === 'done' ? 'ok' : 'bad' },
                run.live ? 'running' : (run.outcome ?? ''),
              ),
            ),
          ),
        ),
      ),
    );
  return { node };
}

function runView(id: string): View {
  const status = h('p', { class: 'muted' }, 'Loading…');
  const lost = h('p', { class: 'bad', role: 'alert' });
  let started = false;
  const answer = h('pre', { class: 'answer' });
  const steps = h('div');
  const node = h(
    'section',
    { 'aria-label': 'Run' },
    h('p', {}, h('a', { href: '#runs' }, '← All runs')),
    status,
    lost,
    h('h2', {}, 'Answer'),
    answer,
    h('h2', {}, 'Steps'),
    steps,
  );
  const stop = listen<RunLine>(
    `/ui/api/runs/${encodeURIComponent(id)}`,
    (line, close) => {
      if (line.type === 'head') {
        started = true;
        status.textContent = `${line.app} · ${line.agent} · ${new Date(line.started).toLocaleString()}`;
        steps.append(h('details', {}, h('summary', {}, 'The message'), h('pre', {}, line.message)));
      } else if (line.type === 'event') {
        const event = line.event;
        if (event.type === 'text') answer.append(event.delta);
        else if (event.type === 'break') answer.append('\n\n');
        else if (event.type === 'activity') steps.append(h('p', { class: 'muted' }, event.label));
        else if (event.type === 'error') steps.append(h('p', { class: 'bad' }, event.message));
      } else if (line.type === 'tool_call') {
        steps.append(h('p', {}, `Asked the app: ${line.name}`));
      } else if (line.type === 'tool_result') {
        steps.append(
          h(
            'p',
            { class: line.isError ? 'bad' : 'muted' },
            line.isError ? 'The app answered with an error.' : 'The app answered.',
          ),
        );
      } else if (line.type === 'end') {
        status.append(` · ${line.outcome}`);
        close();
      }
    },
    () => {
      // A stream that fails is not told apart from one that ends: a run that isn't there, too.
      if (!started) status.remove();
      lost.textContent = "The run's stream ended before the run did.";
    },
  );
  return { node, stop };
}
