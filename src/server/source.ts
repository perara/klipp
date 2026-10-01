import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Never readable, even when git tracks them. */
const DENIED = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.npmrc$/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/,
  /(^|\/)secrets?(\/|\.)/i,
];
const MAX_BYTES = 1_000_000;
const DEFAULT_LINES = 400;
const MAX_LINES = 800;
const MAX_MATCHES = 80;

export class SourceError extends Error {}

/**
 * Read-only access to the repository the app is built from, for the model's tools. Only files
 * git tracks or would track (not ignored) are visible, so `.env` files, build output and
 * `node_modules` stay out of reach.
 */
export class SourceAccess {
  private listed: { at: number; files: Set<string> } | undefined;

  constructor(readonly root: string) {}

  private files(): Set<string> {
    if (!this.listed || Date.now() - this.listed.at > 30_000) {
      const out = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: this.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      this.listed = { at: Date.now(), files: new Set(out.split('\0').filter(Boolean)) };
    }
    return this.listed.files;
  }

  /** A model-supplied path, made repository-relative and checked. */
  resolve(path: string): string {
    const rel = posix.normalize(
      path
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\/+/, ''),
    );
    if (!rel || rel.startsWith('..') || posix.isAbsolute(rel)) {
      throw new SourceError(`${path} is outside the repository.`);
    }
    if (DENIED.some((pattern) => pattern.test(rel))) {
      throw new SourceError(`${rel} may hold secrets, so it is off limits.`);
    }
    if (!this.files().has(rel)) throw new SourceError(`${rel} is not a file in the repository.`);
    return rel;
  }

  read(path: string, start?: number, end?: number): string {
    const rel = this.resolve(path);
    const absolute = join(this.root, rel);
    if (statSync(absolute).size > MAX_BYTES) throw new SourceError(`${rel} is too large to read.`);
    const lines = readFileSync(absolute, 'utf8').split('\n');
    const from = Math.max(1, Math.floor(start ?? 1));
    const to = Math.min(
      lines.length,
      Math.floor(end ?? from + DEFAULT_LINES - 1),
      from + MAX_LINES - 1,
    );
    if (from > lines.length) throw new SourceError(`${rel} has only ${lines.length} lines.`);
    const body = lines
      .slice(from - 1, to)
      .map((line, i) => `${from + i}\t${line}`)
      .join('\n');
    return `${rel}, lines ${from}–${to} of ${lines.length}\n${body}`;
  }

  search(pattern: string, directory?: string): Promise<string> {
    const scope = directory ? [posix.normalize(directory.replace(/^\.?\/+/, ''))] : [];
    if (scope[0]?.startsWith('..'))
      throw new SourceError(`${directory} is outside the repository.`);
    const args = ['grep', '-n', '-I', '-i', '-E', '--max-count=20', '-e', pattern, '--', ...scope];
    return new Promise((done, fail) => {
      execFile(
        'git',
        args,
        { cwd: this.root, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => {
          // git grep exits 1 when nothing matches.
          if (error && (error as { code?: unknown }).code !== 1) {
            fail(new SourceError(`The search failed: ${error.message.split('\n')[0]}`));
            return;
          }
          const matches = stdout
            .split('\n')
            .filter((line) => line && !DENIED.some((p) => p.test(line.split(':', 1)[0]!)));
          if (!matches.length) return done('No matches.');
          const shown = matches.slice(0, MAX_MATCHES).map((line) => line.slice(0, 240));
          const more =
            matches.length > MAX_MATCHES ? `\n…and ${matches.length - MAX_MATCHES} more` : '';
          done(shown.join('\n') + more);
        },
      );
    });
  }
}
