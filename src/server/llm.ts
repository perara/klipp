import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface TurnRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

export interface TurnResult {
  content: Anthropic.Beta.BetaContentBlock[];
  stop_reason: Anthropic.Beta.BetaStopReason | null;
}

/** One model response, with its text streamed to `onText` as it arrives. */
export type Turn = (request: TurnRequest, onText: (delta: string) => void) => Promise<TurnResult>;

export interface AnthropicTurnOptions {
  /** Default: the SDK's own lookup (`ANTHROPIC_API_KEY`, then a saved login). */
  apiKey?: string;
  model?: string;
  effort?: Effort;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class MissingCredentials extends Error {}

/** Whether the SDK will find credentials: an API key, a token, a saved login, or federation. */
export function hasCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.ANTHROPIC_API_KEY ||
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_PROFILE ||
    env.ANTHROPIC_FEDERATION_RULE_ID ||
    existsSync(join(homedir(), '.config', 'anthropic')),
  );
}

/** A turn on the Claude API. */
export function anthropicTurn(options: AnthropicTurnOptions = {}): Turn {
  let client: Anthropic | undefined;
  return async (request, onText) => {
    if (!client && !options.apiKey && !hasCredentials()) throw new MissingCredentials();
    client ??= new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    // With eager input streaming, a tool input that isn't valid JSON fails the turn; it's
    // re-issued twice before giving up. API errors are never retried here.
    for (let attempt = 0; ; attempt++) {
      const stream = client.beta.messages.stream({
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: 64000,
        output_config: { effort: options.effort ?? 'medium' },
        // On a safety decline, the API re-runs the request on its recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // The system prompt and tools never change, so turns after the first read them from cache.
        cache_control: { type: 'ephemeral' },
        system: request.system,
        tools: request.tools,
        messages: request.messages,
      });
      stream.on('text', onText);
      try {
        const message = await stream.finalMessage();
        return { content: message.content, stop_reason: message.stop_reason };
      } catch (error) {
        if (error instanceof Anthropic.APIError || attempt >= 2) throw error;
      }
    }
  };
}

/** A message for the chat when the model call fails. */
export function describeModelError(error: unknown): string {
  if (error instanceof MissingCredentials) {
    return 'I have no API key yet. Set `ANTHROPIC_API_KEY` (or put it in `.env.local`) where the dev server runs, then restart it.';
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'My API key was turned down. Check `ANTHROPIC_API_KEY` where the dev server runs.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "I'm being rate limited by the API. Give me a moment and try again.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "I can't reach the Claude API from the dev server. Is the machine online?";
  }
  if (error instanceof Anthropic.APIError) {
    return `The Claude API answered ${error.status ?? 'with an error'}: ${error.message}`;
  }
  return `Something went wrong talking to the model: ${error instanceof Error ? error.message : String(error)}`;
}
