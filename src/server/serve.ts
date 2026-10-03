import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createKlippMiddleware, type KlippServerOptions } from './handler.js';

export interface ServeOptions extends KlippServerOptions {
  port: number;
  /** Default: `127.0.0.1`. Listening anywhere else needs `identity`: a sign-in proxy in front. */
  host?: string | undefined;
}

export interface KlippServer {
  readonly server: Server;
  readonly url: string;
  /** Stops every agent run, then the server. */
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Klipp's chat as its own HTTP server, for a shared environment where no dev server runs: put
 * it behind the sign-in proxy that serves the app, and route the app's `/@klipp/` to it.
 * `GET /healthz` answers `ok`, for the container's health check.
 */
export async function serve(options: ServeOptions): Promise<KlippServer> {
  const host = options.host ?? '127.0.0.1';
  if (!options.identity && !LOOPBACK.has(host)) {
    throw new Error(
      `Klipp listens on ${host} only behind a sign-in proxy: set identity (KLIPP_IDENTITY_HEADER), or listen on 127.0.0.1.`,
    );
  }
  const middleware = createKlippMiddleware(options);
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url ?? '').split('?', 1)[0] === '/healthz') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('ok');
      return;
    }
    middleware(req, res, (error) => {
      res.statusCode = error ? 500 : 404;
      res.end();
    });
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, host, () => done());
  });
  const { port } = server.address() as AddressInfo;
  const shown = host.includes(':') ? `[${host}]` : host;
  return {
    server,
    url: `http://${shown}:${port}`,
    async close() {
      middleware.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}
