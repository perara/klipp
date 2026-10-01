import { execFileSync } from 'node:child_process';

export interface GitInfo {
  toplevel?: string;
  repo?: string;
  commit?: string;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `https://token@github.com/o/r.git` → `https://github.com/o/r`. */
export function normalizeRemote(remote: string): string | undefined {
  const scp = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(remote.trim());
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return undefined;
    return `https://${url.hostname}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
  } catch {
    return undefined;
  }
}

export function readGit(cwd: string, env: NodeJS.ProcessEnv = process.env): GitInfo {
  const remote = git(cwd, ['remote', 'get-url', 'origin'])?.trim();
  const actions = env.GITHUB_REPOSITORY
    ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}`
    : undefined;
  const info: GitInfo = {};
  const toplevel = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  const repo = env.KLIPP_REPO ?? (remote ? normalizeRemote(remote) : undefined) ?? actions;
  const commit = env.KLIPP_COMMIT ?? git(cwd, ['rev-parse', 'HEAD'])?.trim();
  if (toplevel) info.toplevel = toplevel;
  if (repo) info.repo = repo;
  if (commit) info.commit = commit;
  return info;
}

/** Paths from `git status --porcelain -z`; a rename lists only its new path. */
export function parsePorcelain(output: string): string[] {
  const files: string[] = [];
  const parts = output.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return files;
}

export function dirtyFiles(toplevel: string): string[] {
  const output = git(toplevel, ['status', '--porcelain', '-z', '--untracked-files=all']);
  return output ? parsePorcelain(output) : [];
}
