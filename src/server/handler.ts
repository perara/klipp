import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KlippManifest } from '../shared/manifest.js';
import type {
  AgentId,
  AgentsResponse,
  ChatEvent,
  ChatRequest,
  IssueDraft,
  IssueResponse,
  ToolResultRequest,
} from '../shared/protocol.js';
import { AGENTS, onPath } from './agents.js';
import { answerTool, Conversations, runTurn } from './conversation.js';
import { fileGitHubIssue, githubToken } from './github.js';
import { McpBridge } from './mcp.js';
import { PAGE_TOOLS } from './prompt.js';

export interface KlippServerOptions {
  /** The repository root the agent works in, read-only. */
  root: string;
  /** Repository address for filing issues, such as `https://github.com/owner/repo`. */
  repo?: string;
  /** The manifest, served under development; a build serves its own file. */
  manifest?: () => KlippManifest;
  /** Which agent to start with when both are installed. Default: Claude. */
  agent?: AgentId;
  /** Passed to the agent's `--model`/`-m`. */
  model?: string;
  /** Replace an agent's command, as the tests do: the command and its leading arguments. */
  commands?: Partial<Record<AgentId, string[]>>;
  /** Environment for the GitHub token lookup. */
  env?: Record<string, string | undefined>;
  /** Replaces filing on GitHub, as tests do. Returns the issue's address. */
  fileIssue?: (draft: IssueDraft) => Promise<string>;
  /** Answer requests from other machines too. Default: loopback only, since the agent runs as you. */
  allowRemote?: boolean;
  version?: string;
}

type Next = (error?: unknown) => void;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Who may call: the same machine, with Klipp's header (a cross-site page can't add it without
 * a preflight the dev server refuses), and from the page's own origin.
 */
function allowed(req: IncomingMessage, allowRemote: boolean): boolean {
  if (!allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) return false;
  if (req.headers['x-klipp'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return false;
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

/** Connect-style middleware: the chat, page-tool answers, issue filing, and (in development) the manifest. */
export function createKlippMiddleware(options: KlippServerOptions) {
  const bridge = new McpBridge(PAGE_TOOLS, options.version);
  const conversations = new Conversations();
  const command = (agent: AgentId) => options.commands?.[agent] ?? [AGENTS[agent].binary];

  function agents(): AgentsResponse {
    const list = (Object.keys(AGENTS) as AgentId[]).map((id) => ({
      id,
      label: AGENTS[id].label,
      available: onPath(command(id)[0]!),
    }));
    const wanted = options.agent ?? 'claude';
    const preferred =
      list.find((a) => a.id === wanted && a.available)?.id ??
      list.find((a) => a.available)?.id ??
      wanted;
    return { agents: list, preferred };
  }

  const fileIssue =
    options.fileIssue ??
    (async (draft: IssueDraft) => {
      if (!options.repo) throw new Error('No GitHub repository is known for this app.');
      const token = githubToken(options.env ?? process.env);
      if (!token)
        throw new Error('No GitHub token: log in with `gh auth login` or set GITHUB_TOKEN.');
      return fileGitHubIssue(options.repo, draft, token);
    });

  async function chat(req: IncomingMessage, res: ServerResponse) {
    const request = (await readJson(req)) as ChatRequest;
    if (!(request.agent in AGENTS) || typeof request.text !== 'string' || !request.page) {
      return json(res, 400, { error: 'A chat message needs an agent, text and the page.' });
    }
    const conversation = conversations.get(request.conversation, request.agent);
    if (conversation.busy) return json(res, 409, { error: 'Klipp is still answering.' });
    conversation.busy = true;
    await bridge.start();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    const aborted = new AbortController();
    res.on('close', () => aborted.abort());
    const emit = (event: ChatEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    emit({ type: 'conversation', id: conversation.id });
    try {
      if (!onPath(command(request.agent)[0]!)) {
        const name = AGENTS[request.agent].binary;
        emit({
          type: 'error',
          message: `I can't find \`${name}\` on this machine. Install it and log in, then restart the dev server.`,
        });
        return;
      }
      await runTurn(conversation, request.text, request.page, {
        agent: AGENTS[request.agent],
        command: command(request.agent),
        root: options.root,
        bridge,
        ...(options.model ? { model: options.model } : {}),
        emit,
        signal: aborted.signal,
      });
    } finally {
      conversation.busy = false;
      res.end();
    }
  }

  async function toolResult(req: IncomingMessage, res: ServerResponse) {
    const result = (await readJson(req)) as ToolResultRequest;
    const conversation = conversations.find(String(result.conversation));
    const delivered =
      conversation !== undefined &&
      typeof result.content === 'string' &&
      answerTool(conversation, {
        id: String(result.id),
        content: result.content,
        ...(result.isError ? { isError: true } : {}),
      });
    json(res, delivered ? 200 : 404, { delivered });
  }

  async function issue(req: IncomingMessage, res: ServerResponse) {
    const draft = (await readJson(req)) as IssueDraft;
    if (typeof draft.title !== 'string' || typeof draft.body !== 'string' || !draft.title.trim()) {
      return json(res, 400, {
        error: 'An issue needs a title and a body.',
      } satisfies IssueResponse);
    }
    try {
      json(res, 200, { url: await fileIssue(draft) } satisfies IssueResponse);
    } catch (error) {
      json(res, 502, {
        error: error instanceof Error ? error.message : String(error),
      } satisfies IssueResponse);
    }
  }

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
    chat,
    'tool-result': toolResult,
    issue,
  };

  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '').split('?', 1)[0]!;
    const match = /\/@klipp\/([\w.-]+)$/.exec(path);
    if (!match) return next();
    const name = match[1]!;
    if (req.method === 'GET' && name === 'manifest.json' && options.manifest) {
      return json(res, 200, options.manifest());
    }
    if (req.method === 'GET' && name === 'agents') {
      if (!allowed(req, options.allowRemote ?? false))
        return json(res, 403, { error: 'Not allowed.' });
      return json(res, 200, agents());
    }
    const route = routes[name];
    if (!route || req.method !== 'POST') return next();
    if (!allowed(req, options.allowRemote ?? false))
      return json(res, 403, { error: 'Not allowed.' });
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) res.end();
      else json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    });
  };
}
