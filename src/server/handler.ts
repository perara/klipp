import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KlippManifest } from '../shared/manifest.js';
import type { ChatEvent, ChatRequest, IssueDraft, IssueResponse } from '../shared/protocol.js';
import { advance, Conversations } from './agent.js';
import { fileGitHubIssue, githubToken } from './github.js';
import { anthropicTurn, type Effort, type Turn } from './llm.js';
import { SourceAccess } from './source.js';

export interface KlippServerOptions {
  /** The repository root the model may read. */
  root: string;
  /** Repository address for filing issues, such as `https://github.com/owner/repo`. */
  repo?: string;
  /** The manifest, served under development; a build serves its own file. */
  manifest?: () => KlippManifest;
  model?: string;
  effort?: Effort;
  apiKey?: string;
  /** Environment for the GitHub token lookup. */
  env?: Record<string, string | undefined>;
  /** Replaces the model, as tests do. */
  turn?: Turn;
  /** Replaces filing on GitHub, as tests do. Returns the issue's address. */
  fileIssue?: (draft: IssueDraft) => Promise<string>;
  /** Answer requests from other machines too. Default: loopback only, since the key is yours. */
  allowRemote?: boolean;
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
  return (
    req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  );
}

/** Connect-style middleware for the chat, issue filing and (under development) the manifest. */
export function createKlippMiddleware(options: KlippServerOptions) {
  const source = new SourceAccess(options.root);
  const conversations = new Conversations();
  const turn =
    options.turn ??
    anthropicTurn({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
    });
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
    const conversation = conversations.get(request.conversation);
    if (conversation.busy) return json(res, 409, { error: 'Klipp is still answering.' });
    conversation.busy = true;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    const emit = (event: ChatEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    emit({ type: 'conversation', id: conversation.id });
    try {
      await advance(conversation, request.input, { turn, source, emit });
    } finally {
      conversation.busy = false;
      res.end();
    }
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

  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '').split('?', 1)[0]!;
    if (!path.includes('/@klipp/')) return next();
    if (path.endsWith('/@klipp/manifest.json') && req.method === 'GET' && options.manifest) {
      return json(res, 200, options.manifest());
    }
    const route = path.endsWith('/@klipp/chat')
      ? chat
      : path.endsWith('/@klipp/issue')
        ? issue
        : undefined;
    if (!route || req.method !== 'POST') return next();
    if (!allowed(req, options.allowRemote ?? false))
      return json(res, 403, { error: 'Not allowed.' });
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) res.end();
      else json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    });
  };
}
