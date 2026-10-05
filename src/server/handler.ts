import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KlippManifest } from '../shared/manifest.js';
import type {
  AgentId,
  AgentsResponse,
  ChatEvent,
  ChatRequest,
  IssueDraft,
  IssueRequest,
  IssueResponse,
  PairRequest,
  ToolResultRequest,
} from '../shared/protocol.js';
import { DEFAULT_LABELS, ticketBody, type TicketType } from '../shared/ticket.js';
import { AGENTS } from './agents.js';
import { answerTool, Conversations, runTurn } from './conversation.js';
import { fileGitHubIssue, githubToken } from './github.js';
import { fromKlipp, isLocal, Pairing } from './guard.js';
import { json, readJson } from './http.js';
import { Identity, type IdentityOptions } from './identity.js';
import { McpBridge } from './mcp.js';
import { localRunner, WINDOWS, type Runner } from './runner.js';

export interface KlippServerOptions {
  /** The repository root the agent works in, read-only. */
  root: string;
  /** Repository address for filing issues, such as `https://github.com/owner/repo`. */
  repo?: string;
  /** The manifest, served under development; a build serves its own file. */
  manifest?: () => KlippManifest | Promise<KlippManifest>;
  /** Which agent to start with when both are installed. Default: Claude. */
  agent?: AgentId;
  /** Passed to the agent's `--model`/`-m`. */
  model?: string;
  /** Replace an agent's command, as the tests do: the command and its leading arguments. */
  commands?: Partial<Record<AgentId, string[]>>;
  /** More of the dev server's environment variables to pass to the agent, by name. */
  passEnv?: string[];
  /** Environment for the GitHub token lookup. */
  env?: Record<string, string | undefined>;
  /** GitHub labels per ticket type. Default: bug, enhancement, suggestion, question; each with klipp. */
  labels?: Partial<Record<TicketType, string[]>>;
  /** Replaces filing on GitHub, as tests do. Returns the issue's address. */
  fileIssue?: (draft: IssueDraft, labels: string[]) => Promise<string>;
  /**
   * Answer other devices and addresses too, once paired with the code from `pairing.code`.
   * Default: only a browser on this machine at localhost, since the agent runs as you.
   */
  allowRemote?: boolean;
  /** The code other devices pair with when `allowRemote` is on. Default: a new random one per start. */
  pairingCode?: string;
  /** Agent runs at once, across every conversation. Default: 4. */
  maxRuns?: number;
  /**
   * Behind a sign-in proxy: the header it names the user in, and who may chat. The chat then
   * answers them instead of only localhost; each conversation is theirs alone, and tickets say
   * who reported them.
   */
  identity?: IdentityOptions | undefined;
  /** Told about each turn and each filed ticket: metadata only, never what anyone typed. */
  log?: ((entry: KlippLogEntry) => void) | undefined;
  version?: string;
}

export type KlippLogEntry =
  | {
      event: 'turn';
      agent: AgentId;
      user?: string | undefined;
      conversation: string;
      ms: number;
      outcome: 'answered' | 'failed' | 'stopped';
    }
  | { event: 'filed'; user?: string | undefined; url: string }
  | { event: 'limited'; user: string };

export interface KlippMiddleware {
  (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void;
  /** Present when `allowRemote` is on: the code other devices pair with. */
  readonly pairing: Pairing | undefined;
  /** Stops every run and the MCP bridge, for when the dev server closes. */
  close(): void;
}

/** GitHub refuses issue bodies over 65,536 characters; the ticket needs room too. */
const MAX_FOOTER = 16_000;

/** Connect-style middleware: the chat, page-tool answers, issue filing, and (in development) the manifest. */
export function createKlippMiddleware(options: KlippServerOptions): KlippMiddleware {
  const bridge = new McpBridge(options.version);
  const runner: Runner = localRunner({
    root: options.root,
    bridge,
    commands: options.commands,
    passEnv: options.passEnv,
  });
  const conversations = new Conversations();
  const runs = new Set<AbortController>();
  const identity = options.identity ? new Identity(options.identity) : undefined;
  // Behind a sign-in proxy the proxy decides who gets in; pairing is for a dev server.
  const pairing = options.allowRemote && !identity ? new Pairing(options.pairingCode) : undefined;
  const maxRuns = options.maxRuns ?? 4;
  const log = options.log ?? (() => undefined);
  /** The signed-in user, behind a sign-in proxy; checked by `refusal` before any route runs. */
  const userOf = (req: IncomingMessage): string | undefined => {
    const who = identity?.userOf(req);
    return who && 'user' in who ? who.user : undefined;
  };
  const windows = process.platform === 'win32' && !options.commands;

  async function agents(): Promise<AgentsResponse> {
    const list = await Promise.all(
      (Object.keys(AGENTS) as AgentId[]).map(async (id) => {
        const problem = await runner.problem(id);
        return {
          id,
          label: AGENTS[id].label,
          available: !problem,
          ...(problem ? { problem } : {}),
        };
      }),
    );
    const wanted = options.agent ?? 'claude';
    const preferred =
      list.find((a) => a.id === wanted && a.available)?.id ??
      list.find((a) => a.available)?.id ??
      wanted;
    return { agents: list, preferred, ...(windows ? { problem: WINDOWS } : {}) };
  }

  const fileIssue =
    options.fileIssue ??
    (async (draft: IssueDraft, labels: string[]) => {
      if (!options.repo) throw new Error('No GitHub repository is known for this app.');
      const token = githubToken(options.repo, options.env ?? process.env);
      return fileGitHubIssue(options.repo, draft, token, labels);
    });
  const labelsFor = (type: TicketType): string[] => options.labels?.[type] ?? DEFAULT_LABELS[type];

  async function chat(req: IncomingMessage, res: ServerResponse) {
    const request = (await readJson(req)) as Partial<ChatRequest>;
    const agent = request.agent;
    if (
      typeof agent !== 'string' ||
      !Object.hasOwn(AGENTS, agent) ||
      typeof request.text !== 'string' ||
      typeof request.page !== 'object' ||
      request.page === null
    ) {
      return json(res, 400, { error: 'A chat message needs an agent, text and the page.' });
    }
    const user = userOf(req);
    const conversation = conversations.get(
      typeof request.conversation === 'string' ? request.conversation : undefined,
      agent,
      user,
    );
    if (conversation.busy) return json(res, 409, { error: 'Klipp is still answering.' });
    if (conversations.running() >= maxRuns) {
      return json(res, 429, { error: 'Klipp is answering too many conversations at once.' });
    }
    if (identity && user && !identity.allowMessage(user)) {
      log({ event: 'limited', user });
      return json(res, 429, {
        error: "You've sent Klipp a lot of messages in the last hour. Try again a little later.",
      });
    }
    conversation.busy = true;
    const started = Date.now();
    let outcome: 'answered' | 'failed' | 'stopped' = 'answered';
    const aborted = new AbortController();
    runs.add(aborted);
    res.on('close', () => aborted.abort());
    try {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      const emit = (event: ChatEvent) => {
        if (event.type === 'error') outcome = 'failed';
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      emit({ type: 'conversation', id: conversation.id });
      const problem = await runner.problem(agent);
      if (problem) return emit({ type: 'error', message: problem });
      await runTurn(conversation, request.text, request.page, {
        runner,
        agent,
        ...(options.model ? { model: options.model } : {}),
        emit,
        signal: aborted.signal,
      });
    } catch (error) {
      outcome = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
      runs.delete(aborted);
      conversation.busy = false;
      res.end();
      if (aborted.signal.aborted) outcome = 'stopped';
      const ms = Date.now() - started;
      log({ event: 'turn', agent, user, conversation: conversation.id, ms, outcome });
    }
  }

  async function toolResult(req: IncomingMessage, res: ServerResponse) {
    const result = (await readJson(req)) as Partial<ToolResultRequest>;
    const conversation = conversations.find(String(result.conversation), userOf(req));
    const delivered =
      conversation !== undefined &&
      typeof result.content === 'string' &&
      answerTool(conversation, {
        id: String(result.id),
        content: result.content,
        ...(result.isError === true ? { isError: true } : {}),
      });
    json(res, delivered ? 200 : 404, { delivered });
  }

  /** Files a ticket the agent proposed and the user is looking at, once. */
  async function issue(req: IncomingMessage, res: ServerResponse) {
    const request = (await readJson(req)) as Partial<IssueRequest>;
    const user = userOf(req);
    const conversation = conversations.find(String(request.conversation), user);
    const proposal = String(request.proposal);
    const ticket = conversation?.proposals.get(proposal);
    if (!conversation || !ticket) {
      return json(res, 404, {
        error: 'That ticket is no longer waiting to be filed.',
      } satisfies IssueResponse);
    }
    if (typeof request.footer !== 'string' || request.footer.length > MAX_FOOTER) {
      return json(res, 400, { error: 'The page details are missing or too long.' });
    }
    conversation.proposals.delete(proposal);
    try {
      // Who reported it comes from the proxy, never from the page.
      const reporter = user ? `\n\nReported by ${user.replace(/[\\`*_[\]()<>#|]/g, '\\$&')}.` : '';
      const body = `${ticketBody(ticket)}\n\n${request.footer}${reporter}`;
      const draft = { title: ticket.title, body, type: ticket.type };
      const url = await fileIssue(draft, labelsFor(ticket.type));
      log({ event: 'filed', user, url });
      json(res, 200, { url } satisfies IssueResponse);
    } catch (error) {
      // Still there to file once whatever went wrong is fixed.
      if (conversation.pending.has(proposal)) conversation.proposals.set(proposal, ticket);
      json(res, 502, {
        error: error instanceof Error ? error.message : String(error),
      } satisfies IssueResponse);
    }
  }

  async function pair(req: IncomingMessage, res: ServerResponse) {
    const request = (await readJson(req)) as Partial<PairRequest>;
    const cookie = pairing?.pair(request.code, req);
    if (!cookie) {
      const error = pairing?.locked
        ? 'Too many wrong codes. Restart the dev server to pair again.'
        : 'That is not the code the dev server printed.';
      return json(res, 403, { error });
    }
    res.setHeader('Set-Cookie', cookie);
    json(res, 200, { paired: true });
  }

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
    agents: async (_req, res) => json(res, 200, await agents()),
    chat,
    'tool-result': toolResult,
    issue,
  };

  /** Why a request may not use the chat, or undefined when it may. */
  function refusal(req: IncomingMessage): [number, string] | undefined {
    if (!fromKlipp(req)) return [403, 'Not allowed.'];
    if (identity) {
      const who = identity.userOf(req);
      return 'refused' in who ? who.refused : undefined;
    }
    if (isLocal(req) || pairing?.paired(req)) return undefined;
    if (!pairing) {
      return [
        403,
        "Klipp's chat answers a browser on this machine at localhost. For other devices or addresses, turn on chat.allowRemote.",
      ];
    }
    return [
      401,
      "Pair this device first: open the link Klipp printed in the dev server's terminal.",
    ];
  }

  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    const path = (req.url ?? '').split('?', 1)[0]!;
    const name = /\/@klipp\/([\w.-]+)$/.exec(path)?.[1];
    if (!name) return next();
    if (req.method === 'GET' && name === 'manifest.json' && options.manifest) {
      Promise.resolve(options.manifest()).then(
        (manifest) => json(res, 200, manifest),
        (error: unknown) => next(error),
      );
      return;
    }
    const route = name === 'pair' && pairing ? pair : routes[name];
    const method = name === 'agents' ? 'GET' : 'POST';
    if (!route || req.method !== method) return next();
    const refused =
      name === 'pair' ? (fromKlipp(req) ? undefined : [403, 'Not allowed.']) : refusal(req);
    if (refused) return json(res, refused[0] as number, { error: refused[1] });
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) res.end();
      else json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    });
  };

  return Object.assign(middleware, {
    pairing,
    close() {
      for (const run of runs) run.abort();
      bridge.close();
    },
  });
}
