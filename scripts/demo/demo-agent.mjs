// The agent behind the README's demo. It speaks Claude Code's stream format and calls Klipp's
// page tools over MCP like the real thing; its lines are taken from a real Codex session on the
// example app, replayed with steady timing so the recording is short and repeatable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const session = after('--resume') ?? after('--session-id');
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callTool(name, input) {
  const server = JSON.parse(after('--mcp-config')).mcpServers.klipp;
  const post = async (body) => {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: server.headers.Authorization },
      body: JSON.stringify(body),
    });
    return response.status === 202 ? undefined : response.json();
  };
  await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {} },
  });
  const answer = await post({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: input },
  });
  return answer.result.content[0].text;
}

async function say(text) {
  out({ type: 'stream_event', event: { type: 'message_start' } });
  for (const word of text.split(/(?<= )/)) {
    out({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } },
    });
    await wait(45);
  }
}

async function reading(file) {
  out({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: join(process.cwd(), file) } },
      ],
    },
  });
  await wait(900);
}

const message = readFileSync(0, 'utf8').toLowerCase();
out({ type: 'system', subtype: 'init', session_id: session });
await wait(900);

if (message.includes("doesn't work")) {
  await callTool('point_at_element', { prompt: "Point at the Save button that doesn't work." });
  await reading('examples/react-app/src/App.tsx');
  await reading('examples/react-app/src/app.css');
  await say(
    'Save is disabled at `App.tsx:50`, and a `.veil` div covers it at line 53. What should happen when you press it, and how much does it get in your way?',
  );
} else if (message.includes('save my changes')) {
  await say("Thanks! That's a **bug**: here's the ticket.");
  await wait(500);
  const result = await callTool('propose_ticket', {
    type: 'bug',
    title: "Save button can't be pressed",
    summary: "Save on the example page can't be pressed, so changes can't be saved.",
    actual: 'Clicking Save does nothing; the changes are not saved.',
    expected: "Clicking Save saves the user's changes.",
    steps: ['Open the example page', 'Click Save', 'Nothing happens'],
    frequency: 'Every time',
    severity: 'major',
    code_findings:
      'examples/react-app/src/App.tsx:50 renders Save with disabled and no click handler.\nexamples/react-app/src/App.tsx:53 renders a .veil div over it; examples/react-app/src/app.css:40 positions it on top.',
  });
  await say(
    result.startsWith('Filed') ? 'Filed, and labelled **bug**. 📎' : 'No problem, it stays here.',
  );
} else {
  await say("Hi! Tell me what's wrong, and point at it.");
}
out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: session });
