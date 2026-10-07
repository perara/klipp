// A stand-in for `claude` and `codex` in Klipp's tests. It takes the same command line, prints
// the same JSON lines, keeps a session across runs, and calls Klipp's page tools over MCP the
// way the real agents do. What it says follows a small script keyed on the user's words.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);

// Signing in, for the AI box's tests: the login is a marker file in the agent's config folder.
const home = process.env.CLAUDE_CONFIG_DIR ?? process.env.CODEX_HOME ?? tmpdir();
const marker = join(home, 'fake-signed-in');
if (args[0] === '--version') {
  console.log('9.9.9 (fake)');
  process.exit(0);
}
// `claude auth status` prints JSON, and says "api_key" when an API key is what signs it in
// (CLAUDE_FAKE_AUTH=api_key). `codex login status` says how to stderr, with exit 0 for any
// login: CODEX_FAKE_AUTH=api_key is one with an API key.
if (args[0] === 'auth' && args[1] === 'status') {
  const method = process.env.CLAUDE_FAKE_AUTH ?? (existsSync(marker) ? 'claude.ai' : 'none');
  console.log(JSON.stringify({ loggedIn: method !== 'none', authMethod: method }));
  process.exit(method === 'none' ? 1 : 0);
}
if (args[0] === 'login' && args[1] === 'status') {
  if (process.env.CODEX_FAKE_AUTH === 'api_key') {
    console.error('Logged in using an API key - sk-proj-***ABCDE');
    process.exit(0);
  }
  console.error(existsSync(marker) ? 'Logged in using ChatGPT' : 'Not logged in');
  process.exit(existsSync(marker) ? 0 : 1);
}
if ((args[0] === 'auth' && args[1] === 'logout') || args[0] === 'logout') {
  rmSync(marker, { force: true });
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'login') {
  // The box signs in with the subscription, never the Console's API billing.
  if (!args.includes('--claudeai')) {
    console.error('Refusing: sign in with --claudeai');
    process.exit(2);
  }
  console.log(
    "If the browser didn't open, visit: https://claude.example/oauth/authorize?code=true",
  );
  process.stdout.write('Paste code here if prompted > ');
  const code = await new Promise((done) =>
    createInterface({ input: process.stdin }).once('line', done),
  );
  if (code !== 'good-code') {
    console.error('Invalid code');
    process.exit(1);
  }
  writeFileSync(marker, '');
  console.log('Login successful.');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === '--device-auth') {
  writeFileSync(join(home, 'login.pid'), String(process.pid));
  console.log('1. Open this link\n   \x1b[94mhttps://auth.example/codex/device\x1b[0m');
  console.log('2. Enter this one-time code\n   \x1b[94mABCD-EFGH\x1b[0m');
  await new Promise((done) => setTimeout(done, Number(process.env.CODEX_FAKE_DEVICE_MS ?? 300)));
  if (process.env.CODEX_FAKE_DEVICE_ERROR) {
    console.error(process.env.CODEX_FAKE_DEVICE_ERROR);
    process.exit(1);
  }
  writeFileSync(marker, '');
  console.log('Successfully logged in');
  process.exit(0);
}

// `codex sandbox -- true`: Klipp's check that Codex's sandbox can run. CODEX_FAKE_SANDBOX=broken
// fails it the way a locked-down container does.
if (args[0] === 'sandbox') {
  if (process.env.CODEX_FAKE_SANDBOX === 'broken') {
    process.stderr.write('bwrap: No permissions to create a new namespace\n');
    process.exit(1);
  }
  process.exit(0);
}
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
  // Like Claude Code, the config is a file or the JSON itself.
  const config = after('--mcp-config');
  const json = config.trimStart().startsWith('{') ? config : readFileSync(config, 'utf8');
  const server = JSON.parse(json).mcpServers.klipp;
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
  const image = answer.result.content.find((block) => block.type === 'image');
  return answer.result.content[0].text + (image ? ` Image received: ${image.mimeType}.` : '');
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
} else if (q.includes('screenshot')) {
  const requested = /screenshot id (\S+)/.exec(question)?.[1];
  const region = q.includes('region') ? { x: 0, y: 0, width: 120, height: 120 } : undefined;
  const result = await callTool('take_screenshot', {
    ...(requested ? { id: requested } : {}),
    ...(region ? { region } : {}),
  });
  say(result);
} else if (q.includes('report')) {
  const result = await callTool('propose_ticket', {
    type: 'bug',
    title: 'Count does nothing',
    summary: 'The Count button does not count.',
    actual: 'Nothing happens when Count is clicked.',
    expected: 'The count goes up by one.',
    steps: ['Open the page', 'Click Count'],
    frequency: 'Every time',
    severity: 'major',
    code_findings: 'examples/react-app/src/Button.tsx:5 renders the button.',
  });
  if (result.startsWith('Filed')) say('Filed! 📎');
  else if (result.startsWith('The user decided')) say("OK, I won't file it.");
  else say(`Noted: ${result}`);
} else if (q.includes('idea')) {
  // A feature request is only complete with the need behind it.
  const need = q.includes('because')
    ? question.slice(question.toLowerCase().indexOf('because'))
    : undefined;
  const result = await callTool('propose_ticket', {
    type: 'feature',
    title: 'Dark mode toggle',
    summary: 'A switch for dark mode.',
    proposal: 'A toggle in the header that switches to dark mode.',
    ...(need ? { need } : {}),
  });
  if (result.startsWith('Not shown'))
    say(`What do you need it for? (${result.split(':')[1]?.split('.')[0]?.trim()})`);
  else say(result.startsWith('Filed') ? 'Filed! 📎' : `Noted: ${result}`);
} else if (q.includes('suggest')) {
  const result = await callTool('propose_ticket', {
    type: 'suggestion',
    title: 'Name the Reverse button for what it does',
    summary: 'Reverse is unclear.',
    current: 'The button says Reverse.',
    proposal: 'Call it Reverse units.',
    benefit: 'People know what it reverses.',
  });
  say(result.startsWith('Filed') ? 'Filed! 📎' : `Noted: ${result}`);
} else if (q.includes('vanish')) {
  // Shows a ticket, then stops without waiting for the answer, as an agent that crashes would.
  void callTool('propose_ticket', {
    type: 'question',
    title: 'What does Reverse do?',
    summary: 'The user asked what Reverse does.',
    question: 'What does Reverse do?',
  }).catch(() => undefined);
  await new Promise((done) => setTimeout(done, 1500));
  say('I have to go.');
  if (codex) out({ type: 'turn.completed', usage: {} });
  else
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: session });
  process.exit(0);
} else if (q.includes('linger')) {
  // Answers, then stays on ("linger <ms>") before it exits by itself, which it notes. A CLI
  // that is stopped first never gets to.
  say('Bye for now.');
  if (codex) out({ type: 'turn.completed', usage: {} });
  else
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: session });
  await new Promise((done) => setTimeout(done, Number(/linger (\d+)/.exec(q)?.[1] ?? 500)));
  writeFileSync(memory, 'lingered');
  process.exit(0);
} else if (q.includes('api key')) {
  // Keys bill an account, not the subscription: the box keeps them from the agents.
  const keys = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
  ];
  const seen = [...keys, 'CLAUDE_CODE_OAUTH_TOKEN'].filter((name) => process.env[name]);
  say(`visible: ${seen.join(', ') || 'none'}`);
} else if (q.includes('environment')) {
  // What a run is given: the dev server's own secrets stay out.
  say(`DATABASE_URL: ${process.env.DATABASE_URL ? 'visible' : 'hidden'}`);
} else if (q.includes('context')) {
  say(`page_context: ${message.split('</page_context>').length - 1} closing tag`);
} else if (page.element?.canvas && q.includes('describe')) {
  const { tag, id, canvas } = page.element;
  const code = canvas.code ? `; made at ${canvas.code.file}:${canvas.code.line}` : '';
  const facts = Object.entries(canvas.details ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  say(`${tag} ${id} draws ${canvas.label} (${facts})${code}`);
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
    const lines = readFileSync(element.code.file, 'utf8').split('\n');
    const source = lines[element.code.line - 1].trim();
    say(`I read it: \`${source}\``);
  }
} else {
  say('Hello! I am a test paperclip.');
}

writeFileSync(memory, question);
if (codex) out({ type: 'turn.completed', usage: {} });
else out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: session });
