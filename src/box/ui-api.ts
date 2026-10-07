import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromKlipp } from '../server/guard.js';
import { json, readJson } from '../server/http.js';
import type { Runner } from '../server/runner.js';
import type { BoxIdentity } from './identity.js';
import type { BoxAudit } from './server.js';
import { LOGIN_LABELS, type LoginId, type AgentStatus, type Logins } from './logins.js';
import type { RunLog } from './runlog.js';
import type { Tokens } from './tokens.js';

export interface UiDeps {
  identity?: BoxIdentity | undefined;
  audit?: ((entry: BoxAudit) => void) | undefined;
  runner: Runner;
  logins: Logins;
  tokens: Tokens;
  log: RunLog;
  /** How often a quiet stream gets a comment line, so nothing in between closes it. Default: 15 s. */
  keepAliveMs?: number | undefined;
}

const isAgent = (value: string | undefined): value is LoginId =>
  value !== undefined && Object.hasOwn(LOGIN_LABELS, value);

function sse(res: ServerResponse, keepAliveMs: number) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const write = (text: string) => {
    if (!res.writableEnded) res.write(text);
  };
  // A comment line is no message; it keeps a quiet stream open. Ended with the response.
  const timer = setInterval(() => write(': keep-alive\n\n'), keepAliveMs);
  res.once('close', () => clearInterval(timer));
  return (value: unknown) => write(`data: ${JSON.stringify(value)}\n\n`);
}

const empty = (res: ServerResponse) => {
  res.statusCode = 204;
  res.end();
};

/** The path's parts after `/ui/api/`, decoded; undefined when one isn't valid percent-encoding. */
function partsOf(path: string): string[] | undefined {
  try {
    return path.slice('/ui/api/'.length).split('/').map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

/** What the box's own web page calls: agents and their sign-in, tokens, runs. */
export function createUiApi(deps: UiDeps) {
  const auditedLogins = new WeakSet<object>();
  const keepAliveMs = deps.keepAliveMs ?? 15_000;
  const agents = (): Promise<AgentStatus[]> =>
    Promise.all(
      (Object.keys(LOGIN_LABELS) as LoginId[]).map(async (id) => {
        const [problem, signedIn, version] = await Promise.all([
          id === 'github' ? Promise.resolve(undefined) : deps.runner.problem(id),
          deps.logins.signedIn(id),
          deps.logins.version(id),
        ]);
        return {
          id,
          label: LOGIN_LABELS[id],
          signedIn,
          ...(version ? { version } : {}),
          ...(problem ? { problem } : {}),
        };
      }),
    );

  /** Answers a `/ui/api/…` request; false when no route matches. */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    user?: string,
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    const audit = (action: BoxAudit['action'], target: string) => {
      deps.audit?.({ user: user ?? 'local-owner', action, target });
    };
    // Another site's page can fire requests at localhost, even blind GETs that start CLIs or hold a
    // stream open: the browser says where a request comes from, and only the page itself passes.
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') {
      json(res, 403, { error: 'Not allowed.' });
      return true;
    }
    if (method !== 'GET' && !(deps.identity ? deps.identity.fromPage(req) : fromKlipp(req))) {
      json(res, 403, { error: 'Not allowed.' });
      return true;
    }
    const parts = partsOf(path);
    if (!parts) return (json(res, 400, { error: 'That path is not valid.' }), true);
    if (parts.length > 3) return false;
    const [section, id, action] = parts;

    if (section === 'session' && method === 'GET' && !id) {
      return (json(res, 200, { user: user ?? null }), true);
    }

    if (section === 'agents') {
      if (method === 'GET' && !id) return (json(res, 200, await agents()), true);
      if (method === 'POST' && isAgent(id) && action === 'login') {
        const login = deps.logins.start(id);
        if (!auditedLogins.has(login)) {
          auditedLogins.add(login);
          audit('agent.login.start', id);
          const stop = login.subscribe((state) => {
            if (state.state === 'done' || state.state === 'failed') {
              audit(state.state === 'done' ? 'agent.login.done' : 'agent.login.failed', id);
              // subscribe immediately reports the current state, including a finished login.
              queueMicrotask(() => stop?.());
            }
          });
        }
        return (json(res, 200, { login: login.id }), true);
      }
      if (method === 'POST' && isAgent(id) && action === 'logout') {
        await deps.logins.logout(id);
        audit('agent.logout', id);
        return (empty(res), true);
      }
    }

    if (section === 'logins' && id) {
      const login = deps.logins.get(id);
      if (!login) return (json(res, 404, { error: 'No such sign-in.' }), true);
      if (method === 'GET' && !action) {
        const send = sse(res, keepAliveMs);
        const stop = login.subscribe((state) => {
          send(state);
          if (state.state === 'done' || state.state === 'failed') res.end();
        });
        res.on('close', stop);
        return true;
      }
      if (method === 'POST' && action === 'code') {
        const body = await readJson(req);
        const sent = typeof body.code === 'string' && login.sendCode(body.code.trim());
        return (
          json(res, sent ? 200 : 400, sent ? { sent } : { error: 'That code could not be sent.' }),
          true
        );
      }
      if (method === 'DELETE' && !action) {
        login.cancel();
        audit('agent.login.cancel', login.agent);
        return (empty(res), true);
      }
    }

    if (section === 'tokens') {
      if (method === 'GET' && !id) return (json(res, 200, deps.tokens.list()), true);
      if (method === 'POST' && !id) {
        const body = await readJson(req);
        try {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const token = deps.tokens.create(name);
          audit('token.create', name);
          json(res, 200, { token });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }
      if (method === 'DELETE' && id && !action) {
        if (deps.tokens.revoke(id)) {
          audit('token.revoke', id);
          empty(res);
        } else json(res, 404, { error: 'No such token, or it comes from the environment.' });
        return true;
      }
    }

    if (section === 'runs' && method === 'GET' && !action) {
      if (!id) return (json(res, 200, deps.log.list()), true);
      const lines = deps.log.read(id);
      if (!lines) return (json(res, 404, { error: 'No such run.' }), true);
      const send = sse(res, keepAliveMs);
      for (const line of lines) send(line);
      // Reading the file and following it happen in one tick, so no line falls between them.
      if (!deps.log.isLive(id)) return (res.end(), true);
      const stop = deps.log.follow(id, (line) => {
        send(line);
        if (line.type === 'end') res.end();
      });
      res.on('close', stop);
      return true;
    }
    return false;
  }

  return { handle };
}
