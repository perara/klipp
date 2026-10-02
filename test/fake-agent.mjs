// A stand-in for `claude` and `codex` in Klipp's tests. It takes the same command line, prints
// the same JSON lines, keeps a session across runs, and calls Klipp's page tools over MCP the
// way the real agents do. What it says follows a small script keyed on the user's words.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const codex = args[0] === 'exec';
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

const session = codex
  ? args[1] === 'resume'
    ? args[2]
    : crypto.randomUUID()
  : (after('--resume') ?? after('--session-id'));
const memory = join(tmpdir(), `klipp-fake-agent-${session}.txt`);

function bridge() {
  if (codex) {
    const setting = args.find((a) => a.startsWith('mcp_servers.klipp.url='));
    return {
      url: JSON.parse(setting.slice('mcp_servers.klipp.url='.length)),
      auth: `Bearer ${process.env.KLIPP_MCP_TOKEN}`,
    };
  }
  const server = JSON.parse(after('--mcp-config')).mcpServers.klipp;
  return { url: server.url, auth: server.headers.Authorization };
}

async function callTool(name, input) {
  const { url, auth } = bridge();
  const post = async (body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });
    return response.status === 202 ? undefined : response.json();
  };
  await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake', version: '0' },
    },
  });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const answer = await post({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: input },
  });
  return answer.result.content[0].text;
}

let said = 0;
function say(text) {
  if (codex) {
    out({ type: 'item.completed', item: { id: `item_${said++}`, type: 'agent_message', text } });
    return;
  }
  out({ type: 'stream_event', event: { type: 'message_start' } });
  for (const word of text.split(/(?<= )/)) {
    out({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } },
    });
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

function reading(file, line) {
  if (codex) {
    out({
      type: 'item.started',
      item: { type: 'command_execution', command: `/bin/bash -lc 'sed -n ${line}p ${file}'` },
    });
  } else {
    out({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: join(process.cwd(), file) } },
        ],
      },
    });
  }
}

const message = readFileSync(0, 'utf8');
const [, pageJson, question = ''] =
  /<page_context>\n(.*)\n<\/page_context>\n\n([\s\S]*)$/s.exec(message) ?? [];
const page = JSON.parse(pageJson ?? '{}');
const q = question.toLowerCase();

if (codex) out({ type: 'thread.started', thread_id: session });
else out({ type: 'system', subtype: 'init', session_id: session });
if (codex) out({ type: 'turn.started' });

if (q.includes('break')) {
  const text = 'Failed to authenticate: OAuth session expired';
  if (codex) out({ type: 'turn.failed', error: { message: text } });
  else
    out({ type: 'result', subtype: 'success', is_error: true, result: text, session_id: session });
  process.exit(1);
}

if (q.includes('what did i say')) {
  say(`You said: ${existsSync(memory) ? readFileSync(memory, 'utf8') : 'nothing yet'}`);
} else if (q.includes('who are you')) {
  say(codex ? 'I am Codex, in a paperclip.' : 'I am Claude, in a paperclip.');
} else if (q.includes('report')) {
  const result = await callTool('propose_issue', {
    title: 'Count does nothing',
    body: 'The **Count** button does not count.',
  });
  if (result.startsWith('Filed')) say('Filed! 📎');
  else if (result.startsWith('The user decided')) say("OK, I won't file it.");
  else say(`Noted: ${result}`);
} else if (page.element && q.includes('describe')) {
  const { tag, states, beneath } = page.element;
  say(
    `${tag}; states: ${states.join(', ') || 'none'}; beneath: ${beneath.map((b) => b.tag).join(', ')}`,
  );
} else if (page.element) {
  say(`You pointed at \`<${page.element.tag}>\` in ${page.element.code?.component}.`);
} else if (q.includes('button')) {
  const result = await callTool('point_at_element', { prompt: 'Click the button you mean.' });
  if (!result.startsWith('{')) {
    say('No problem.');
  } else {
    const element = JSON.parse(result);
    reading(element.code.file, element.code.line);
    const source = readFileSync(element.code.file, 'utf8')
      .split('\n')
      [element.code.line - 1].trim();
    say(`I read it: \`${source}\``);
  }
} else {
  say('Hello! I am a test paperclip.');
}

writeFileSync(memory, question);
if (codex) out({ type: 'turn.completed', usage: {} });
else out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: session });
