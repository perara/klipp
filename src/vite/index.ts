import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnv,
  normalizePath,
  type Plugin,
  type PreviewServer,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite';
import { createKlippMiddleware, type KlippMiddleware } from '../server/handler.js';
import type { KlippManifest, ManifestEntry } from '../shared/manifest.js';
import type { AgentId, IssueDraft } from '../shared/protocol.js';
import type { TicketType } from '../shared/ticket.js';
import type { Corner, RuntimeConfig } from '../shared/runtime-config.js';
import { dirtyFiles, readGit, type GitInfo } from './git.js';
import { stamp } from './stamp.js';

export type {
  KlippManifest,
  ManifestEntry,
  RuntimeConfig,
  Corner,
  AgentId,
  IssueDraft,
  TicketType,
};

export interface ChatOptions {
  /** Which agent to start with when both are installed. Default: `claude`. */
  agent?: AgentId;
  /** Passed to the agent as its model. Default: the agent's own default. */
  model?: string;
  /**
   * Let other devices and addresses use the chat too, such as a phone on the LAN or a tunnel.
   * Each device pairs once with the link the dev server prints. Default: false, which answers
   * only a browser on this machine at localhost.
   */
  allowRemote?: boolean;
  /**
   * A fixed pairing code, at least 10 characters, for a shared test environment whose testers
   * shouldn't need a new link after every restart. Default: a new random code on each start.
   */
  pairingCode?: string;
  /**
   * More of the dev server's environment variables to pass to the agent, by name. The agent
   * gets only what it needs to start and log in: PATH, HOME, locale, proxies, and its own
   * variables (`ANTHROPIC_*`, `CLAUDE_*` or `OPENAI_*`, `CODEX_*`, and the like).
   */
  passEnv?: string[];
  /** Agent runs at once, across every conversation. Default: 4. */
  maxRuns?: number;
  /** Replace an agent's command and leading arguments, as the tests do. */
  commands?: Partial<Record<AgentId, string[]>>;
  /**
   * Run the agents in an AI box (`klipp box`) instead of on this machine. The token defaults to
   * `KLIPP_BOX_TOKEN` from the environment or `.env`, so it stays out of the config; the address
   * can come from `KLIPP_BOX_URL` the same way.
   */
  box?: { url: string; token?: string | undefined } | undefined;
  /** GitHub labels per ticket type. Default: bug, enhancement, suggestion, question; each with klipp. */
  labels?: Partial<Record<TicketType, string[]>>;
  /** Replaces filing on GitHub, as the tests do. Returns the issue's address. */
  fileIssue?: (draft: IssueDraft, labels: string[]) => Promise<string>;
}

export interface KlippOptions {
  /**
   * Default: on under the dev server, off in builds unless `KLIPP=1`, and off under Vitest.
   * `KLIPP=0` turns it off everywhere.
   */
  enabled?: boolean;
  /** Files to stamp. Default: `.jsx` and `.tsx`. */
  include?: RegExp;
  /** Files never to stamp. Default: anything in `node_modules`. */
  exclude?: RegExp;
  /** Also mark component call sites, so a shared component tells its uses apart. Default: true. */
  stampComponents?: boolean;
  /** Repository web address for permalinks. Default: from `git remote get-url origin`. */
  repo?: string;
  /** Commit for permalinks. Default: `git rev-parse HEAD`. */
  commit?: string;
  /** Default: `alt+shift+k`. */
  hotkey?: string;
  /** Where the paperclip sits. Default: `bottom-right`; `false` leaves only the hotkey. */
  launcher?: Corner | false;
  /** Moves the paperclip in from its corner, in pixels, to clear things the app keeps there. */
  offset?: { x?: number; y?: number };
  /** Show the character in browsers driven by automation too. Default: false. */
  launcherUnderAutomation?: boolean;
  /**
   * Query parameters a page needs to open the same way, such as a `demo` flag. They keep their
   * values in reports and Klipp links; every other query value is blanked. Default: none.
   */
  keepQuery?: string[];
  /**
   * The chat. The dev server (and `vite preview`) runs Claude Code or Codex in the background,
   * read-only in the repository, with your own login; nothing needs an API key. Issues are
   * filed with `gh`'s login or `GITHUB_TOKEN`. `false` turns the chat off.
   */
  chat?: ChatOptions | false;
}

const ENTRY = '/@klipp/entry';
const RESOLVED_ENTRY = '\0klipp-entry';
const ENDPOINT = '@klipp/';
const DEV_MANIFEST = '@klipp/manifest.json';
const BUILD_MANIFEST = 'klipp-manifest.json';

/** The browser runtime: compiled JavaScript when installed, TypeScript when run from source. */
function clientEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = join(here, '../client/index.js');
  return normalizePath(existsSync(js) ? js : join(here, '../client/index.ts'));
}

export function isEnabled(
  option: boolean | undefined,
  command: 'serve' | 'build',
  env: NodeJS.ProcessEnv,
): boolean {
  if (option !== undefined) return option;
  if (env.KLIPP === '0' || env.VITEST) return false;
  return env.KLIPP === '1' || command === 'serve';
}

export default function klipp(options: KlippOptions = {}): Plugin {
  const include = options.include ?? /\.[jt]sx$/;
  const exclude = options.exclude ?? /\/node_modules\//;
  const entries = new Map<string, ManifestEntry>();
  const sidsByFile = new Map<string, string[]>();
  let config: ResolvedConfig;
  let enabled = false;
  let git: GitInfo = {};
  /** `git status`, refreshed in the background at most every two seconds. */
  let dirty: { at: number; files: Promise<string[]> } | undefined;
  let middleware: KlippMiddleware | undefined;

  const repoPath = (file: string) =>
    relative(git.toplevel ?? config.root, file)
      .split(sep)
      .join('/');

  function currentDirtyFiles(): Promise<string[]> {
    if (!git.toplevel) return Promise.resolve([]);
    if (!dirty || Date.now() - dirty.at > 2000) {
      dirty = { at: Date.now(), files: dirtyFiles(git.toplevel) };
    }
    return dirty.files;
  }

  async function manifest(): Promise<KlippManifest> {
    const repo = options.repo ?? git.repo;
    const commit = options.commit ?? git.commit;
    const changed = (await currentDirtyFiles()).filter((file) => sidsByFile.has(file));
    return {
      version: 1,
      ...(repo ? { repo } : {}),
      ...(commit ? { commit } : {}),
      ...(changed.length ? { dirtyFiles: changed } : {}),
      entries: Object.fromEntries(entries),
    };
  }

  function replaceEntries(file: string, next: Array<[string, ManifestEntry]>) {
    for (const sid of sidsByFile.get(file) ?? []) entries.delete(sid);
    for (const [sid, entry] of next) {
      const clash = entries.get(sid);
      if (clash && (clash.file !== entry.file || clash.line !== entry.line)) {
        config.logger.warn(
          `[klipp] ${clash.file}:${clash.line} and ${entry.file}:${entry.line} hash to the same id ${sid}`,
        );
      }
      entries.set(sid, entry);
    }
    sidsByFile.set(
      file,
      next.map(([sid]) => sid),
    );
  }

  function runtimeConfig(): RuntimeConfig {
    const dev = config.command === 'serve';
    return {
      manifestUrl: `${config.base}${dev ? DEV_MANIFEST : BUILD_MANIFEST}`,
      dev,
      hotkey: options.hotkey ?? 'alt+shift+k',
      launcher: options.launcher ?? 'bottom-right',
      launcherUnderAutomation: options.launcherUnderAutomation ?? false,
      keepQuery: options.keepQuery ?? [],
      endpoint: `${config.base}${ENDPOINT}`,
      chat: options.chat !== false,
      offset: { x: options.offset?.x ?? 0, y: options.offset?.y ?? 0 },
    };
  }

  /**
   * The chat's routes, on the dev or preview server; the dev server also serves the manifest.
   * Closing the server stops every agent run.
   */
  function mountChat(server: ViteDevServer | PreviewServer, dev: boolean) {
    const chat: ChatOptions = options.chat === false ? {} : (options.chat ?? {});
    const { box, ...rest } = chat;
    const envDir = typeof config.envDir === 'string' ? config.envDir : config.root;
    const env = loadEnv(config.mode, envDir, [
      'KLIPP_',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'GH_HOST',
      'GH_ENTERPRISE_TOKEN',
      'GITHUB_ENTERPRISE_TOKEN',
    ]);
    const repo = options.repo ?? git.repo;
    const boxUrl = box?.url ?? env.KLIPP_BOX_URL;
    middleware?.close();
    const mounted = createKlippMiddleware({
      root: git.toplevel ?? config.root,
      env,
      ...(repo ? { repo } : {}),
      ...(dev ? { manifest } : {}),
      ...rest,
      ...(boxUrl ? { box: { url: boxUrl, token: box?.token ?? env.KLIPP_BOX_TOKEN ?? '' } } : {}),
    });
    middleware = mounted;
    server.middlewares.use(mounted);
    server.httpServer?.once('close', () => mounted.close());
    if (mounted.pairing) {
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const code = mounted.pairing!.code;
        const network = server.resolvedUrls?.network[0];
        config.logger.info(
          network
            ? `  ➜  Klipp:   pair other devices with ${network}?klipp-pair=${code}`
            : `  ➜  Klipp:   pair other devices by adding ?klipp-pair=${code} to the address (start with --host to reach the network)`,
        );
      };
    }
  }

  return {
    name: 'klipp',
    enforce: 'pre',

    configResolved(resolved) {
      config = resolved;
      enabled = isEnabled(options.enabled, resolved.command, process.env);
      if (!enabled) return;
      git = readGit(resolved.root);
      // Lets the dev server serve the runtime when Klipp is linked from outside the project.
      const allow = resolved.server.fs.allow;
      if (Array.isArray(allow)) allow.push(normalizePath(dirname(dirname(clientEntry()))));
    },

    configureServer(server) {
      if (enabled) mountChat(server, true);
    },

    configurePreviewServer(server) {
      // Only for a build made with Klipp; it left its manifest in the output.
      const outDir = resolve(config.root, config.build.outDir);
      if (enabled && existsSync(join(outDir, BUILD_MANIFEST))) mountChat(server, false);
    },

    resolveId(id) {
      return enabled && id.endsWith(ENTRY) ? RESOLVED_ENTRY : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ENTRY) return undefined;
      return [
        `import { start } from ${JSON.stringify(clientEntry())};`,
        `start(${JSON.stringify(runtimeConfig())});`,
      ].join('\n');
    },

    transform: {
      filter: { id: { include, exclude } },
      async handler(code, id) {
        const file = id.split('?', 1)[0]!;
        if (!enabled || id.startsWith('\0') || !include.test(file) || exclude.test(file)) {
          return null;
        }
        const rel = repoPath(file);
        const result = await stamp(code, file, {
          file: rel,
          stampComponents: options.stampComponents ?? true,
          warn: (message) => config.logger.warn(`[klipp] ${message}`, { timestamp: true }),
          isExternal: async (source) => {
            const resolved = await this.resolve(source, file, { skipSelf: true });
            return (
              !resolved ||
              Boolean(resolved.external) ||
              resolved.id.startsWith('\0') ||
              /\/node_modules\//.test(resolved.id)
            );
          },
        });
        replaceEntries(rel, result?.entries ?? []);
        return result ? { code: result.code, map: result.map } : null;
      },
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!enabled) return undefined;
        return [{ tag: 'script', attrs: { type: 'module', src: ENTRY }, injectTo: 'head' }];
      },
    },

    async generateBundle() {
      // A server bundle is stamped like the client's, so hydrated markup keeps its IDs; the
      // manifest goes with the client.
      if (!enabled || config.command !== 'build' || config.build.ssr) return;
      this.emitFile({
        type: 'asset',
        fileName: BUILD_MANIFEST,
        source: JSON.stringify(await manifest()),
      });
    },
  };
}
