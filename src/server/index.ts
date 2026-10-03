/**
 * Klipp's chat server, for a shared environment where no Vite dev server runs: `serve()` as its
 * own HTTP server (or `klipp serve`), or `createKlippMiddleware()` inside another Node server.
 * Either way it belongs behind a sign-in proxy; see `identity`.
 */
export {
  createKlippMiddleware,
  type KlippLogEntry,
  type KlippMiddleware,
  type KlippServerOptions,
} from './handler.js';
export type { IdentityOptions } from './identity.js';
export { optionsFromEnv } from './env.js';
export { serve, type KlippServer, type ServeOptions } from './serve.js';
