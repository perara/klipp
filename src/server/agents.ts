import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import type { AgentId } from '../shared/protocol.js';

export interface RunSpec {
  /** The repository root: the agent works there, read-only. */
  root: string;
  /** System prompt plus the page context and what the user typed. */
  system: string;
  message: string;
  /** The agent's own session id, to carry the conversation on. */
  session?: string;
  /** Claude takes a fresh session's id up front. */
  newSession: string;
  mcpUrl: string;
  mcpToken: string;
  model?: string;
}

export type AgentEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'break' }
  | { type: 'activity'; label: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface Agent {
  id: AgentId;
  label: string;
  binary: string;
  args(spec: RunSpec): string[];
  env(spec: RunSpec): Record<string, string>;
  /** Written to the process's stdin, which is then closed. */
  input(spec: RunSpec): string;
  /** A parser for one run's stdout, one JSON line at a time. */
  parser(root: string): (line: string) => AgentEvent[];
}

const PAGE_TOOL_NAMES = ['point_at_element', 'inspect_element', 'propose_ticket'];

/** Files no agent run reads, even when git tracks them. */
const SECRET_FILES = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa*',
  'id_ed25519*',
  '.npmrc',
];

const short = (root: string, path: unknown) => {
  const text = String(path ?? '');
  return isAbsolute(text) ? relative(root, text) || text : text;
};

const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const LOGIN_HINT = /authenticat|log ?in|logged out|oauth|credential|unauthori[sz]ed|401/i;

/** Claude Code, headless: restricted mode, only Read/Grep/Glob plus Klipp's page tools. */
export const claude: Agent = {
  id: 'claude',
  label: 'Claude',
  binary: 'claude',
  args(spec) {
    const mcp = {
      mcpServers: {
        klipp: {
          type: 'http',
          url: spec.mcpUrl,
          headers: { Authorization: `Bearer ${spec.mcpToken}` },
        },
      },
    };
    const deny = SECRET_FILES.flatMap((pattern) => [`Read(${pattern})`, `Read(**/${pattern})`]);
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      // No command-running tools or web access, file tools confined to the repository, and
      // the user's own settings, hooks and MCP servers left out.
      '--restricted',
      '--tools',
      'Read,Grep,Glob',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify(mcp),
      '--settings',
      JSON.stringify({ permissions: { deny } }),
      '--permission-mode',
      'dontAsk',
      '--append-system-prompt',
      spec.system,
      ...(spec.session ? ['--resume', spec.session] : ['--session-id', spec.newSession]),
      ...(spec.model ? ['--model', spec.model] : []),
      '--allowedTools',
      'Read',
      'Grep',
      'Glob',
      ...PAGE_TOOL_NAMES.map((name) => `mcp__klipp__${name}`),
    ];
  },
  // Picking an element can take a while; the default MCP tool timeout would give up first.
  env: () => ({ MCP_TOOL_TIMEOUT: String(30 * 60 * 1000) }),
  input: (spec) => spec.message,
  parser(root) {
    let wrote = false;
    return (line) => {
      const event = parse(line);
      if (!event) return [];
      if (
        event.type === 'system' &&
        event.subtype === 'init' &&
        typeof event.session_id === 'string'
      ) {
        return [{ type: 'session', id: event.session_id }];
      }
      if (event.type === 'stream_event') {
        const inner = event.event as { type?: string; delta?: { type?: string; text?: string } };
        if (inner.type === 'message_start' && wrote) return [{ type: 'break' }];
        if (
          inner.type === 'content_block_delta' &&
          inner.delta?.type === 'text_delta' &&
          inner.delta.text
        ) {
          wrote = true;
          return [{ type: 'text', delta: inner.delta.text }];
        }
        return [];
      }
      if (event.type === 'assistant') {
        const content = ((event.message as { content?: unknown[] })?.content ?? []) as Array<{
          type: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
        return content.flatMap((block): AgentEvent[] => {
          if (block.type !== 'tool_use') return [];
          if (block.name === 'Read')
            return [{ type: 'activity', label: `Reading ${short(root, block.input?.file_path)}` }];
          if (block.name === 'Grep')
            return [{ type: 'activity', label: `Searching for ${String(block.input?.pattern)}` }];
          if (block.name === 'Glob')
            return [{ type: 'activity', label: `Looking for ${String(block.input?.pattern)}` }];
          return [];
        });
      }
      if (event.type === 'result') {
        if (!event.is_error) return [{ type: 'done' }];
        const text = String(event.result ?? 'Claude stopped with an error.');
        const hint = LOGIN_HINT.test(text)
          ? ' Run `claude` in a terminal and log in, then try again.'
          : '';
        return [{ type: 'error', message: `${text}${hint}` }];
      }
      return [];
    };
  },
};

/** Codex, headless: a read-only sandbox, never asking for approval, Klipp's page tools allowed. */
export const codex: Agent = {
  id: 'codex',
  label: 'Codex',
  binary: 'codex',
  args(spec) {
    const config = [
      'sandbox_mode="read-only"',
      'approval_policy="never"',
      `developer_instructions=${JSON.stringify(spec.system)}`,
      `mcp_servers.klipp.url=${JSON.stringify(spec.mcpUrl)}`,
      'mcp_servers.klipp.bearer_token_env_var="KLIPP_MCP_TOKEN"',
      'mcp_servers.klipp.tool_timeout_sec=1800',
      // Only Klipp's own tools; they reach nothing but the page the user is looking at.
      'mcp_servers.klipp.default_tools_approval_mode="approve"',
    ].flatMap((setting) => ['-c', setting]);
    return [
      'exec',
      ...(spec.session ? ['resume', spec.session] : []),
      '--json',
      '--skip-git-repo-check',
      // Your own config.toml (its MCP servers and settings) stays out; the login still works.
      '--ignore-user-config',
      ...config,
      ...(spec.model ? ['-m', spec.model] : []),
      '-',
    ];
  },
  env: (spec) => ({ KLIPP_MCP_TOKEN: spec.mcpToken }),
  input: (spec) => spec.message,
  parser() {
    let wrote = false;
    return (line) => {
      const event = parse(line);
      if (!event) return [];
      const item = (event.item ?? {}) as { type?: string; text?: string; command?: string };
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        return [{ type: 'session', id: event.thread_id }];
      }
      if (event.type === 'item.started' && item.type === 'command_execution' && item.command) {
        const command = item.command
          .replace(/^(\/usr)?\/bin\/(ba|z)?sh -lc /, '')
          .replace(/^['"]|['"]$/g, '');
        return [
          {
            type: 'activity',
            label: `Running ${command.length > 80 ? `${command.slice(0, 79)}…` : command}`,
          },
        ];
      }
      if (event.type === 'item.completed' && item.type === 'agent_message' && item.text) {
        const events: AgentEvent[] = wrote ? [{ type: 'break' }] : [];
        wrote = true;
        return [...events, { type: 'text', delta: item.text }];
      }
      if (event.type === 'turn.completed') return [{ type: 'done' }];
      if (event.type === 'turn.failed' || event.type === 'error') {
        const error = event.error as { message?: string } | undefined;
        const text = String(error?.message ?? event.message ?? 'Codex stopped with an error.');
        const hint = LOGIN_HINT.test(text)
          ? ' Run `codex login` in a terminal, then try again.'
          : '';
        return [{ type: 'error', message: `${text}${hint}` }];
      }
      return [];
    };
  },
};

export const AGENTS: Record<AgentId, Agent> = { claude, codex };

/** Whether a command can be found: an absolute path that exists, or a name on PATH. */
export function onPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAbsolute(command)) return existsSync(command);
  return (env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, command)));
}
