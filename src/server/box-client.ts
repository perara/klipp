import type { AgentId, AgentsResponse } from '../shared/protocol.js';
import type { AgentEvent } from './agents.js';
import type { Runner } from './runner.js';

/** An AI box (`klipp box`) and the token it knows this app by. */
export interface BoxConnection {
  url: string;
  token: string;
}

const EVENT_TYPES = new Set(['session', 'text', 'break', 'activity', 'error', 'done']);

/** A stream's lines as text, however its chunks are cut; '' is a keep-alive. */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      yield buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
    }
  }
}

/** Runs the agents in an AI box, over box protocol v1. */
export function boxRunner(box: BoxConnection, fetchImpl: typeof fetch = fetch): Runner {
  const base = box.url.replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${box.token}` };
  const unreachable = `The AI box at ${base} isn't answering.`;
  let cache: { at: number; agents: Promise<Map<AgentId, string | undefined>> } | undefined;

  async function refusal(response: Response): Promise<string> {
    if (response.status === 401) return "The AI box refused Klipp's token.";
    if (response.status === 429) return 'The AI box is busy; try again shortly.';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') return body.error;
    } catch {
      // Not JSON: fall through.
    }
    return `The AI box at ${base} answered ${response.status}.`;
  }

  async function load(): Promise<Map<AgentId, string | undefined>> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/v1/agents`, { headers: auth });
    } catch {
      throw new Error(unreachable);
    }
    if (!response.ok) throw new Error(await refusal(response));
    const body = (await response.json()) as AgentsResponse;
    return new Map(
      body.agents.map((a) => [
        a.id,
        a.available ? undefined : (a.problem ?? `${a.label} can't run in the AI box.`),
      ]),
    );
  }

  return {
    async problem(agent) {
      if (!cache || Date.now() - cache.at > 10_000) cache = { at: Date.now(), agents: load() };
      try {
        return (await cache.agents).get(agent);
      } catch (error) {
        cache = undefined;
        return error instanceof Error ? error.message : String(error);
      }
    },

    async run(request, hooks) {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/v1/runs`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: hooks.signal,
        });
      } catch {
        if (!hooks.signal.aborted) hooks.onEvent({ type: 'error', message: unreachable });
        return;
      }
      if (!response.ok || !response.body) {
        hooks.onEvent({ type: 'error', message: await refusal(response) });
        return;
      }
      let run = '';
      let finished = false;
      const answer = async (call: { id: string; name: string; input: Record<string, unknown> }) => {
        const result = await hooks.onTool(call.name, call.input);
        await fetchImpl(`${base}/v1/runs/${run}/tools/${call.id}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: result.text, isError: result.isError ?? false }),
        }).catch(() => undefined);
      };
      try {
        for await (const line of ndjsonLines(response.body)) {
          if (!line) continue;
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === 'run' && typeof event.id === 'string') run = event.id;
          else if (
            event.type === 'tool_call' &&
            typeof event.id === 'string' &&
            typeof event.name === 'string'
          ) {
            const input =
              typeof event.input === 'object' && event.input !== null
                ? (event.input as Record<string, unknown>)
                : {};
            void answer({ id: event.id, name: event.name, input });
          } else if (typeof event.type === 'string' && EVENT_TYPES.has(event.type)) {
            if (event.type === 'done' || event.type === 'error') finished = true;
            hooks.onEvent(event as unknown as AgentEvent);
          }
        }
      } catch {
        // The stream broke; said below.
      }
      if (!finished && !hooks.signal.aborted)
        hooks.onEvent({ type: 'error', message: 'Lost the AI box mid-answer.' });
    },
  };
}
