import { execFileSync } from 'node:child_process';
import type { IssueDraft } from '../shared/protocol.js';

const GITHUB = 'github.com';

/**
 * A token for the repository's host, never another's: for github.com, `KLIPP_GITHUB_TOKEN`,
 * `GITHUB_TOKEN` or `GH_TOKEN`; for a GitHub Enterprise host, `GH_ENTERPRISE_TOKEN` or
 * `GITHUB_ENTERPRISE_TOKEN` when `GH_HOST` names it. Otherwise the GitHub CLI's login for that
 * host. A remote on GitLab or anywhere else gets no token, so nothing is sent there.
 */
export function githubToken(
  repo: string,
  env: Record<string, string | undefined>,
  login: (host: string) => string | undefined = ghLogin,
): string {
  const host = new URL(repo).host;
  const token =
    host === GITHUB
      ? (env.KLIPP_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? env.GH_TOKEN)
      : env.GH_HOST === host
        ? (env.GH_ENTERPRISE_TOKEN ?? env.GITHUB_ENTERPRISE_TOKEN)
        : undefined;
  const found = token || login(host);
  if (found) return found;
  throw new Error(
    host === GITHUB
      ? 'No GitHub token: log in with `gh auth login` or set GITHUB_TOKEN.'
      : `Klipp files issues on GitHub, and has no login for ${host}. For GitHub Enterprise, log in with \`gh auth login --hostname ${host}\`.`,
  );
}

/** The GitHub CLI's token for one host, if it is installed and logged in there. */
function ghLogin(host: string): string | undefined {
  try {
    const token = execFileSync('gh', ['auth', 'token', '--hostname', host], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/** `https://github.com/owner/repo` → the REST address for its issues; GitHub Enterprise keeps its own host. */
export function issuesEndpoint(repo: string): string {
  const url = new URL(repo);
  const [owner, name] = url.pathname.slice(1).split('/');
  if (!owner || !name) throw new Error(`${repo} is not a repository address.`);
  const api = url.host === GITHUB ? 'https://api.github.com' : `${url.origin}/api/v3`;
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
    signal: AbortSignal.timeout(30_000),
  });
  const result = (await response.json().catch(() => ({}))) as {
    html_url?: unknown;
    message?: unknown;
  };
  if (!response.ok) {
    const message = typeof result.message === 'string' ? `: ${result.message}` : '';
    throw new Error(`GitHub answered ${response.status}${message}`);
  }
  if (typeof result.html_url !== 'string' || !/^https:\/\//.test(result.html_url)) {
    throw new Error('GitHub filed the issue but gave no address for it.');
  }
  return result.html_url;
}
