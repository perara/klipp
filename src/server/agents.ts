import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { AgentId } from '../shared/protocol.js';

export interface RunSpec {
  /** The repository root: the agent works there, read-only. */
  root: string;
  /** A directory private to this run, for files from `Agent.files`. */
  dir: string;
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
  /** Directories the agent's own install lives in, which its sandbox must be able to read. */
  install: string[];
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
  /** Variables the run sets, on top of those passed through from the dev server. */
  env(spec: RunSpec): Record<string, string>;
  /** Prefixes of the dev server's variables the agent needs, such as its own login's. */
  envPrefixes: readonly string[];
  /** Files written to `spec.dir`, readable only by this user, before the run starts. */
  files?(spec: RunSpec): Record<string, string>;
  /** Where the command is installed, when the agent's sandbox needs to know. */
  install?(command: string): string[];
  /** Written to the process's stdin, which is then closed. */
  input(spec: RunSpec): string;
  /** A parser for one run's stdout, one JSON line at a time. */
  parser(root: string): (line: string) => AgentEvent[];
}

const PAGE_TOOL_NAMES = ['point_at_element', 'inspect_element', 'propose_ticket'];

/** Files Claude never reads, even when git tracks them. */
const SECRET_FILES = [
  '.env',
  '.env.*',
  '.envrc',
  '.dev.vars',
  '*.tfvars',
  '*.tfstate',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.pgpass',
  'credentials*.json',
  '.git/config',
];

/** What any program needs to start: where things are, who runs it, language, proxies, certificates. */
const BASE_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
]);
const BASE_PREFIXES = ['LC_', 'XDG_'];

/**
 * The dev server's environment, cut down to what the agent needs: the dev server may hold
 * database URLs and tokens that are none of the agent's business. `extra` names more to pass.
 */
export function childEnv(
  agent: Agent,
  env: NodeJS.ProcessEnv,
  extra: readonly string[] = [],
): Record<string, string> {
  const prefixes = [...BASE_PREFIXES, ...agent.envPrefixes];
  const wanted = (name: string) =>
    BASE_ENV.has(name) || extra.includes(name) || prefixes.some((p) => name.startsWith(p));
  return Object.fromEntries(
    Object.entries(env).filter(
      (pair): pair is [string, string] => pair[1] !== undefined && wanted(pair[0]),
    ),
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const short = (root: string, path: unknown) => {
  const file = text(path);
  return isAbsolute(file) ? relative(root, file) || file : file;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : undefined;
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
      join(spec.dir, 'mcp.json'),
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
  // The token stays out of the process list: the config is a file only this user can read.
  files: (spec) => ({
    'mcp.json': JSON.stringify({
      mcpServers: {
        klipp: {
          type: 'http',
          url: spec.mcpUrl,
          headers: { Authorization: `Bearer ${spec.mcpToken}` },
        },
      },
    }),
  }),
  // Picking an element can take a while; the default MCP tool timeout would give up first.
  env: () => ({ MCP_TOOL_TIMEOUT: String(30 * 60 * 1000) }),
  // Its login, and the settings for running it through Bedrock, Vertex or a gateway.
  envPrefixes: ['ANTHROPIC_', 'CLAUDE_', 'AWS_', 'GOOGLE_', 'CLOUD_ML_', 'VERTEX_'],
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
        const inner = isRecord(event.event) ? event.event : {};
        const delta = isRecord(inner.delta) ? inner.delta : {};
        if (inner.type === 'message_start' && wrote) return [{ type: 'break' }];
        if (
          inner.type === 'content_block_delta' &&
          delta.type === 'text_delta' &&
          text(delta.text)
        ) {
          wrote = true;
          return [{ type: 'text', delta: text(delta.text) }];
        }
        return [];
      }
      if (event.type === 'assistant') {
        const message = isRecord(event.message) ? event.message : {};
        const content = Array.isArray(message.content) ? message.content : [];
        return content.filter(isRecord).flatMap((block): AgentEvent[] => {
          if (block.type !== 'tool_use') return [];
          const input = isRecord(block.input) ? block.input : {};
          if (block.name === 'Read')
            return [{ type: 'activity', label: `Reading ${short(root, input.file_path)}` }];
          if (block.name === 'Grep')
            return [{ type: 'activity', label: `Searching for ${text(input.pattern)}` }];
          if (block.name === 'Glob')
            return [{ type: 'activity', label: `Looking for ${text(input.pattern)}` }];
          return [];
        });
      }
      if (event.type === 'result') {
        if (!event.is_error) return [{ type: 'done' }];
        const message = text(event.result) || 'Claude stopped with an error.';
        const hint = LOGIN_HINT.test(message)
          ? ' Run `claude` in a terminal and log in, then try again.'
          : '';
        return [{ type: 'error', message: `${message}${hint}` }];
      }
      return [];
    };
  },
};

/**
 * Where Codex is installed: its sandbox starts Codex again from there, so the sandbox must be
 * able to read it. An npm install keeps the native binary in a sibling package.
 */
export function codexInstall(command: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const found = which(command, env);
  if (!found) return [];
  let real: string;
  try {
    real = realpathSync(found);
  } catch {
    return [];
  }
  const dirs = [dirname(dirname(real))];
  const modules = real.lastIndexOf(`${sep}node_modules${sep}`);
  if (modules >= 0) dirs.push(real.slice(0, modules + sep.length + 'node_modules'.length));
  return dirs;
}

/** TOML for `{ "path" = "read", … }`; a JSON string is a valid TOML basic string. */
const readable = (paths: string[]) =>
  `{${paths.map((path) => `${JSON.stringify(path)}="read"`).join(', ')}}`;

/**
 * Codex, headless: a sandbox that reads only the repository (plus the system files programs
 * need), writes nothing, and gives the commands Codex runs only a core environment; never
 * asking for approval; Klipp's page tools allowed.
 */
export const codex: Agent = {
  id: 'codex',
  label: 'Codex',
  binary: 'codex',
  args(spec) {
    const config = [
      'sandbox_mode="read-only"',
      'default_permissions="klipp"',
      `permissions.klipp.filesystem=${readable([':minimal', ':workspace_roots', ...spec.install])}`,
      'shell_environment_policy.inherit="core"',
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
  envPrefixes: ['OPENAI_', 'CODEX_'],
  install: (command) => codexInstall(command),
  input: (spec) => spec.message,
  parser() {
    let wrote = false;
    return (line) => {
      const event = parse(line);
      if (!event) return [];
      const item = isRecord(event.item) ? event.item : {};
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        return [{ type: 'session', id: event.thread_id }];
      }
      if (
        event.type === 'item.started' &&
        item.type === 'command_execution' &&
        text(item.command)
      ) {
        const command = text(item.command)
          .replace(/^(\/usr)?\/bin\/(ba|z)?sh -lc /, '')
          .replace(/^['"]|['"]$/g, '');
        return [
          {
            type: 'activity',
            label: `Running ${command.length > 80 ? `${command.slice(0, 79)}…` : command}`,
          },
        ];
      }
      if (event.type === 'item.completed' && item.type === 'agent_message' && text(item.text)) {
        const events: AgentEvent[] = wrote ? [{ type: 'break' }] : [];
        wrote = true;
        return [...events, { type: 'text', delta: text(item.text) }];
      }
      if (event.type === 'turn.completed') return [{ type: 'done' }];
      if (event.type === 'turn.failed' || event.type === 'error') {
        const error = isRecord(event.error) ? event.error : {};
        const message =
          text(error.message) || text(event.message) || 'Codex stopped with an error.';
        const hint = LOGIN_HINT.test(message)
          ? ' Run `codex login` in a terminal, then try again.'
          : '';
        return [{ type: 'error', message: `${message}${hint}` }];
      }
      return [];
    };
  },
};

export const AGENTS: Record<AgentId, Agent> = { claude, codex };

/** Where a command is: an absolute path that exists, or the first match on PATH. */
export function which(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isAbsolute(command)) return existsSync(command) ? command : undefined;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, command))) return join(dir, command);
  }
  return undefined;
}

export const onPath = (command: string, env: NodeJS.ProcessEnv = process.env): boolean =>
  which(command, env) !== undefined;
