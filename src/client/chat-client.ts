import type { ChatEvent, ChatRequest, IssueDraft, IssueResponse } from '../shared/protocol.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-Klipp': '1' };

/** No chat server answers here, as on a static deploy. */
export class Unreachable extends Error {}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `The chat server answered ${response.status}.`;
}

/** Sends one turn of the conversation and yields what the server streams back. */
export async function* talk(endpoint: string, request: ChatRequest): AsyncGenerator<ChatEvent> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}chat`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(request),
    });
  } catch {
    throw new Unreachable();
  }
  if (response.status === 404 || response.status === 405) throw new Unreachable();
  if (!response.ok || !response.body) throw new Error(await errorOf(response));
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (chunk.startsWith('data: ')) yield JSON.parse(chunk.slice(6)) as ChatEvent;
    }
  }
}

/** Files the issue through the server and returns its address. */
export async function fileIssue(endpoint: string, draft: IssueDraft): Promise<string> {
  const response = await fetch(`${endpoint}issue`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(draft),
  });
  if (response.status === 404 || response.status === 405)
    throw new Error('No chat server is running.');
  const result = (await response
    .json()
    .catch(() => ({ error: `The server answered ${response.status}.` }))) as IssueResponse;
  if ('url' in result) return result.url;
  throw new Error(result.error);
}
