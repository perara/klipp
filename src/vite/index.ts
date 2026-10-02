import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, normalizePath, type Plugin, type ResolvedConfig } from 'vite';
import { createKlippMiddleware } from '../server/handler.js';
import type { KlippManifest, ManifestEntry } from '../shared/manifest.js';
import type { AgentId, IssueDraft } from '../shared/protocol.js';
import type { Corner, RuntimeConfig } from '../shared/runtime-config.js';
import { dirtyFiles, readGit, type GitInfo } from './git.js';
import { stamp } from './stamp.js';

export type { KlippManifest, ManifestEntry, RuntimeConfig, Corner, AgentId, IssueDraft };

export interface ChatOptions {
  /** Which agent to start with when both are installed. Default: `claude`. */
  agent?: AgentId;
  /** Passed to the agent as its model. Default: the agent's own default. */
  model?: string;
  /** Answer chat requests from other machines too, such as a phone on the LAN. Default: false. */
  allowRemote?: boolean;
  /** Replace an agent's command and leading arguments, as the tests do. */
  commands?: Partial<Record<AgentId, string[]>>;
  /** Replaces filing on GitHub, as the tests do. Returns the issue's address. */
  fileIssue?: (draft: IssueDraft) => Promise<string>;
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
  let dirty: { at: number; files: string[] } | undefined;
  let middleware: ReturnType<typeof createKlippMiddleware> | undefined;

  const repoPath = (file: string) =>
    relative(git.toplevel ?? config.root, file)
      .split(sep)
      .join('/');

  function currentDirtyFiles(): string[] {
    if (!git.toplevel) return [];
    if (!dirty || Date.now() - dirty.at > 2000) {
      dirty = { at: Date.now(), files: dirtyFiles(git.toplevel) };
    }
    return dirty.files;
  }

  function manifest(dev: boolean): KlippManifest {
    const repo = options.repo ?? git.repo;
    const commit = options.commit ?? git.commit;
    const changed = currentDirtyFiles().filter((file) => sidsByFile.has(file));
    return {
      version: 1,
      ...(repo ? { repo } : {}),
      ...(commit ? { commit } : {}),
      ...(changed.length ? { dirtyFiles: changed } : {}),
      ...(dev && git.toplevel ? { root: normalizePath(git.toplevel) } : {}),
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

  /** One middleware for both servers; it serves the manifest only under development. */
  function klippMiddleware() {
    if (middleware) return middleware;
    const chat = options.chat === false ? {} : (options.chat ?? {});
    const envDir = typeof config.envDir === 'string' ? config.envDir : config.root;
    const env = loadEnv(config.mode, envDir, ['KLIPP_', 'GITHUB_TOKEN', 'GH_TOKEN']);
    const repo = options.repo ?? git.repo;
    middleware = createKlippMiddleware({
      root: git.toplevel ?? config.root,
      env,
      ...(repo ? { repo } : {}),
      ...(config.command === 'serve' ? { manifest: () => manifest(true) } : {}),
      ...chat,
    });
    return middleware;
  }

  return {
    name: 'klipp',
    enforce: 'pre',

    configResolved(resolved) {
      config = resolved;
      enabled = isEnabled(options.enabled, resolved.command, process.env) && !resolved.build.ssr;
      if (!enabled) return;
      git = readGit(resolved.root);
      // Lets the dev server serve the runtime when Klipp is linked from outside the project.
      const allow = resolved.server.fs.allow;
      if (Array.isArray(allow)) allow.push(normalizePath(dirname(dirname(clientEntry()))));
    },

    configureServer(server) {
      if (enabled) server.middlewares.use(klippMiddleware());
    },

    configurePreviewServer(server) {
      if (enabled) server.middlewares.use(klippMiddleware());
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

    generateBundle() {
      if (!enabled || config.command !== 'build') return;
      this.emitFile({
        type: 'asset',
        fileName: BUILD_MANIFEST,
        source: JSON.stringify(manifest(false)),
      });
    },
  };
}
