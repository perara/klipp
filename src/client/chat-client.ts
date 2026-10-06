import type {
  AgentsResponse,
  ChatEvent,
  ChatRequest,
  IssueRequest,
  IssueResponse,
  ToolResultRequest,
} from '../shared/protocol.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-Klipp': '1' };

/** No chat server answers here, as on a static deploy. */
export class Unreachable extends Error {}

const missing = (response: Response) => response.status === 404 || response.status === 405;

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `The chat server answered ${response.status}.`;
}

/** Which agents the dev server can run, and which to start with. */
export async function listAgents(endpoint: string): Promise<AgentsResponse> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}agents`, { headers: HEADERS });
  } catch {
    throw new Unreachable();
  }
  if (missing(response) || !(response.headers.get('content-type') ?? '').includes('json'))
    throw new Unreachable();
  if (!response.ok) throw new Error(await errorOf(response));
  return (await response.json()) as AgentsResponse;
}

/** Sends one message and yields what the server streams back while the agent works. */
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
  if (missing(response)) throw new Unreachable();
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

/** Answers a page-tool call the agent is waiting on. */
export async function answerTool(endpoint: string, result: ToolResultRequest): Promise<void> {
  await fetch(`${endpoint}tool-result`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(result),
  }).catch(() => undefined);
}

/**
 * Files the ticket the agent proposed, through the server: its address, or the filled-in
 * new-issue page to submit on GitHub when the server has no token.
 */
export async function fileIssue(
  endpoint: string,
  request: IssueRequest,
): Promise<Exclude<IssueResponse, { error: string }>> {
  const response = await fetch(`${endpoint}issue`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(request),
  });
  if (missing(response)) throw new Error('No chat server is running.');
  const result = (await response
    .json()
    .catch(() => ({ error: `The server answered ${response.status}.` }))) as IssueResponse;
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** Pairs this device with the dev server, which then answers it as it does localhost. */
export async function pair(endpoint: string, code: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${endpoint}pair`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ code }),
    });
    return response.ok ? undefined : await errorOf(response);
  } catch {
    return 'The dev server could not be reached to pair this device.';
  }
}
