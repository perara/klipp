import type { IssueDraft, Turn } from '../../dist/vite/index.js';

type Message = Parameters<Turn>[0]['messages'][number];
type Block = {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  id?: string;
  name?: string;
};

const blocks = (message: Message | undefined): Block[] =>
  !message
    ? []
    : typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : (message.content as Block[]);

/**
 * A stand-in for Claude in the example app, so the end-to-end tests are deterministic and need
 * no API key. It follows a small script keyed on what the user says.
 */
export const fakeTurn: Turn = async ({ messages }, onText) => {
  const say = (text: string) => {
    for (const word of text.split(/(?<= )/)) onText(word);
    return {
      content: [{ type: 'text' as const, text, citations: null }],
      stop_reason: 'end_turn' as const,
    };
  };
  const call = (name: string, input: object) => ({
    content: [{ type: 'tool_use' as const, id: `toolu_${name}_${messages.length}`, name, input }],
    stop_reason: 'tool_use' as const,
  });

  const last = blocks(messages.at(-1));
  const result = last.find((b) => b.type === 'tool_result');
  if (result) {
    const asked = blocks(messages.at(-2)).find((b) => b.id === result.tool_use_id);
    const content = String(result.content);
    if (asked?.name === 'point_at_element') {
      if (!content.startsWith('{')) return say('No problem.');
      const element = JSON.parse(content) as { code: { file: string; line: number } };
      return call('read_file', {
        path: element.code.file,
        start_line: element.code.line,
        end_line: element.code.line,
      });
    }
    if (asked?.name === 'read_file')
      return say(`I read it: \`${content.split('\n')[1]!.split('\t')[1]!.trim()}\``);
    if (asked?.name === 'propose_issue') {
      return say(content.startsWith('Filed') ? 'Filed! 📎' : "OK, I won't file it.");
    }
  }

  const text = last.filter((b) => b.type === 'text').map((b) => b.text ?? '');
  const question = (text.at(-1) ?? '').toLowerCase();
  const page = JSON.parse(
    text[0]?.match(/<page_context>\n(.*)\n<\/page_context>/s)?.[1] ?? '{}',
  ) as {
    element?: {
      tag: string;
      code?: { component: string };
      states: string[];
      beneath: Array<{ tag: string }>;
    };
  };
  if (question.includes('break')) throw new Error('the test model broke on purpose');
  if (question.includes('report'))
    return call('propose_issue', {
      title: 'Count does nothing',
      body: 'The **Count** button does not count.',
    });
  if (page.element && question.includes('describe')) {
    const { tag, states, beneath } = page.element;
    return say(
      `${tag}; states: ${states.join(', ') || 'none'}; beneath: ${beneath.map((b) => b.tag).join(', ')}`,
    );
  }
  if (page.element)
    return say(`You pointed at \`<${page.element.tag}>\` in ${page.element.code?.component}.`);
  if (question.includes('button'))
    return call('point_at_element', { prompt: 'Click the button you mean.' });
  return say('Hello! I am a test paperclip.');
};

/** Pretends to file the issue, and keeps it for the tests to look at. */
export const filedIssues: IssueDraft[] = [];
export async function fakeFileIssue(draft: IssueDraft): Promise<string> {
  filedIssues.push(draft);
  return `https://github.com/example/app/issues/${filedIssues.length}`;
}
