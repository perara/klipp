import { execFileSync } from 'node:child_process';
import type { IssueDraft } from '../shared/protocol.js';

/** A GitHub token: `KLIPP_GITHUB_TOKEN`, `GITHUB_TOKEN` or `GH_TOKEN`, else the GitHub CLI's login. */
export function githubToken(env: Record<string, string | undefined>): string | undefined {
  const token = env.KLIPP_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (token) return token;
  try {
    return (
      execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** `https://github.com/owner/repo` → the REST address for its issues. */
export function issuesEndpoint(repo: string): string {
  const url = new URL(repo);
  const [owner, name] = url.pathname.slice(1).split('/');
  if (!owner || !name) throw new Error(`${repo} is not a repository address.`);
  const api = url.hostname === 'github.com' ? 'https://api.github.com' : `${url.origin}/api/v3`;
  return `${api}/repos/${owner}/${name}/issues`;
}

/** Files the issue and returns its address. */
export async function fileGitHubIssue(
  repo: string,
  draft: IssueDraft,
  token: string,
  labels: string[] = [],
): Promise<string> {
  const response = await fetch(issuesEndpoint(repo), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'klipp',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: draft.title,
      body: draft.body,
      ...(labels.length ? { labels } : {}),
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    html_url?: string;
    message?: string;
  };
  if (!response.ok || !result.html_url) {
    throw new Error(
      `GitHub answered ${response.status}${result.message ? `: ${result.message}` : ''}`,
    );
  }
  return result.html_url;
}
