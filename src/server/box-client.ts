import type { AgentId, AgentsResponse } from '../shared/protocol.js';
import type { AgentEvent } from './agents.js';
import type { McpResult } from './mcp.js';
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        yield buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
      }
    }
  } finally {
    // A consumer that stops early lets go of the stream, so the box can end its run.
    reader.cancel().catch(() => undefined);
  }
}

/** Runs the agents in an AI box, over box protocol v1. */
export function boxRunner(box: BoxConnection, fetchImpl: typeof fetch = fetch): Runner {
  const base = box.url.replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${box.token}` };
  const unreachable = `The AI box at ${base} isn't answering.`;
  const unexpected = `The AI box at ${base} answered unexpectedly.`;
  const noToken = 'Klipp has no token for the AI box: set KLIPP_BOX_TOKEN.';
  const lost = 'Lost the AI box mid-answer.';
  let cache: { at: number; agents: Promise<Map<AgentId, string | undefined>> } | undefined;

  async function refusal(response: Response): Promise<string> {
    const unread = (message: string) => {
      // Let go of the body, or its connection stays open.
      void response.body?.cancel().catch(() => undefined);
      return message;
    };
    if (response.status === 401) return unread("The AI box refused Klipp's token.");
    if (response.status === 429) return unread('The AI box is busy; try again shortly.');
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
    try {
      const body = (await response.json()) as AgentsResponse;
      return new Map(
        body.agents.map((a) => [
          a.id,
          a.available ? undefined : (a.problem ?? `${a.label} can't run in the AI box.`),
        ]),
      );
    } catch {
      throw new Error(unexpected);
    }
  }

  return {
    async problem(agent) {
      if (!box.token) return noToken;
      if (!cache || Date.now() - cache.at > 10_000) cache = { at: Date.now(), agents: load() };
      try {
        return (await cache.agents).get(agent);
      } catch (error) {
        cache = undefined;
        return error instanceof Error ? error.message : String(error);
      }
    },

    async run(request, hooks) {
      if (!box.token) {
        hooks.onEvent({ type: 'error', message: noToken });
        return;
      }
      // Ours to abort: the caller's abort, a failure, or the end of the turn lets the box go.
      const stop = new AbortController();
      const abort = () => stop.abort();
      hooks.signal.addEventListener('abort', abort);
      if (hooks.signal.aborted) abort();
      let finished = false;
      /** The turn's one ending: an error event, once, unless the turn is over or was stopped. */
      const fail = (message: string) => {
        if (finished || hooks.signal.aborted) return;
        finished = true;
        hooks.onEvent({ type: 'error', message });
        stop.abort();
      };
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${base}/v1/runs`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: stop.signal,
          });
        } catch {
          fail(unreachable);
          return;
        }
        if (!response.ok || !response.body) {
          finished = true;
          hooks.onEvent({ type: 'error', message: await refusal(response) });
          return;
        }
        let runId = '';
        const answer = async (call: {
          id: string;
          name: string;
          input: Record<string, unknown>;
        }) => {
          let result: McpResult;
          try {
            result = await hooks.onTool(call.name, call.input);
          } catch (error) {
            result = {
              text: error instanceof Error ? error.message : String(error),
              isError: true,
            };
          }
          if (stop.signal.aborted) return;
          try {
            const posted = await fetchImpl(`${base}/v1/runs/${runId}/tools/${call.id}`, {
              method: 'POST',
              headers: { ...auth, 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: result.text, isError: result.isError ?? false }),
              signal: stop.signal,
            });
            if (!posted.ok) throw new Error(`The AI box answered ${posted.status}.`);
          } catch {
            fail(lost);
          }
        };
        try {
          for await (const line of ndjsonLines(response.body)) {
            if (finished) break;
            if (!line) continue;
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === 'run' && typeof event.id === 'string') runId = event.id;
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
              if (finished) break;
            }
          }
        } catch {
          // The stream broke, or a line was not JSON; said below.
        }
        fail(lost);
      } finally {
        finished = true;
        hooks.signal.removeEventListener('abort', abort);
        stop.abort();
      }
    },
  };
}
