import type Anthropic from '@anthropic-ai/sdk';
import { CLIENT_TOOLS, type ClientToolName } from '../shared/protocol.js';
import { SourceError, type SourceAccess } from './source.js';

type Tool = Anthropic.Beta.BetaTool;

const tool = (
  name: string,
  description: string,
  properties: Record<string, object>,
  required: string[],
): Tool => ({
  name,
  description,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
  // Inputs stream as they are generated; each one is validated below before it runs.
  eager_input_streaming: true,
});

/** In a fixed order, so the tool list is the same bytes every turn and stays cached. */
export const TOOLS: Tool[] = [
  tool(
    'read_file',
    "Read a file from the app's repository, with line numbers. Paths are relative to the repository root, as in element context. Reads 400 lines from start_line unless end_line says otherwise.",
    {
      path: { type: 'string' },
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
    },
    ['path'],
  ),
  tool(
    'search_code',
    'Search the repository with git grep: an extended regular expression, case-insensitive. Returns up to 80 matching lines as path:line:text. Optionally limit it to a directory.',
    { pattern: { type: 'string' }, directory: { type: 'string' } },
    ['pattern'],
  ),
  tool(
    'point_at_element',
    "Ask the user to click an element on the page. Returns its Klipp ID, the file and line that rendered it, the components it sits in, its state (disabled, hidden, covered by something else), its parent, and what lies beneath it. Use it whenever the user talks about something on screen you haven't seen.",
    {
      prompt: {
        type: 'string',
        description: 'What to ask, such as "Click the button that does nothing."',
      },
    },
    ['prompt'],
  ),
  tool(
    'inspect_element',
    'Look up an element on the page by its Klipp ID, such as a parent or something beneath from earlier context. Returns the same details as point_at_element.',
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'propose_issue',
    'Show the user a GitHub issue draft. They decide whether to file it; the result says whether it was filed, with its address. The page and element details are appended to the body automatically.',
    { title: { type: 'string' }, body: { type: 'string', description: 'Markdown.' } },
    ['title', 'body'],
  ),
];

export class InputError extends Error {}

const text = (
  input: Record<string, unknown>,
  key: string,
  optional = false,
): string | undefined => {
  const value = input[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new InputError(`${key} must be a non-empty string.`);
  return value;
};

const whole = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new InputError(`${key} must be a positive whole number.`);
  }
  return value;
};

export const isClientTool = (name: string): name is ClientToolName =>
  (CLIENT_TOOLS as readonly string[]).includes(name);

/** Checks a client tool's input before the browser sees it. */
export function validateClientInput(name: ClientToolName, input: Record<string, unknown>) {
  if (name === 'point_at_element') text(input, 'prompt');
  if (name === 'inspect_element') text(input, 'id');
  if (name === 'propose_issue') {
    text(input, 'title');
    text(input, 'body');
  }
}

/** A short line for the chat while a server tool runs. */
export function activityLabel(name: string, input: Record<string, unknown>): string {
  if (name === 'read_file') return `Reading ${String(input.path)}`;
  if (name === 'search_code') return `Searching for ${String(input.pattern)}`;
  return name;
}

/** Runs a server tool; problems come back as error text for the model, not exceptions. */
export async function runServerTool(
  name: string,
  input: Record<string, unknown>,
  source: SourceAccess,
): Promise<{ content: string; isError: boolean }> {
  try {
    if (name === 'read_file') {
      return {
        content: source.read(
          text(input, 'path')!,
          whole(input, 'start_line'),
          whole(input, 'end_line'),
        ),
        isError: false,
      };
    }
    if (name === 'search_code') {
      return {
        content: await source.search(text(input, 'pattern')!, text(input, 'directory', true)),
        isError: false,
      };
    }
    return { content: `There is no tool called ${name}.`, isError: true };
  } catch (error) {
    if (error instanceof InputError || error instanceof SourceError) {
      return { content: error.message, isError: true };
    }
    throw error;
  }
}
