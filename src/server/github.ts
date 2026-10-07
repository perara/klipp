import { randomUUID } from 'node:crypto';
import type { Screenshot } from '../shared/screenshot.js';
import { execFileSync } from 'node:child_process';
import type { IssueDraft } from '../shared/protocol.js';

const GITHUB = 'github.com';

/**
 * A token for the repository's host, never another's: for github.com, `KLIPP_GITHUB_TOKEN`,
 * `GITHUB_TOKEN` or `GH_TOKEN`; for a GitHub Enterprise host, `GH_ENTERPRISE_TOKEN` or
 * `GITHUB_ENTERPRISE_TOKEN` when `GH_HOST` names it. Otherwise the GitHub CLI's login for that
 * host. A remote on GitLab or anywhere else gets no token, so nothing is sent there.
 * Undefined for github.com without one: the user then submits the issue there themselves.
 */
export function githubToken(
  repo: string,
  env: Record<string, string | undefined>,
  login: (host: string) => string | undefined = ghLogin,
): string | undefined {
  const host = new URL(repo).host;
  const token =
    host === GITHUB
      ? (env.KLIPP_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? env.GH_TOKEN)
      : env.GH_HOST === host
        ? (env.GH_ENTERPRISE_TOKEN ?? env.GITHUB_ENTERPRISE_TOKEN)
        : undefined;
  const found = token || login(host);
  if (found || host === GITHUB) return found || undefined;
  throw new Error(
    `Klipp files issues on GitHub, and has no login for ${host}. For GitHub Enterprise, log in with \`gh auth login --hostname ${host}\`.`,
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

/** `https://github.com/owner/repo` → its address and `owner/repo`. */
function parseRepo(repo: string): { url: URL; path: string } {
  const url = new URL(repo);
  const [owner, name] = url.pathname.slice(1).split('/');
  if (!owner || !name) throw new Error(`${repo} is not a repository address.`);
  return { url, path: `${owner}/${name}` };
}

/** `https://github.com/owner/repo` → the REST address for its issues; GitHub Enterprise keeps its own host. */
export function issuesEndpoint(repo: string): string {
  const { url, path } = parseRepo(repo);
  const api = url.host === GITHUB ? 'https://api.github.com' : `${url.origin}/api/v3`;
  return `${api}/repos/${path}/issues`;
}

/** Browsers and GitHub take addresses up to about 8,000 characters. */
const MAX_LINK = 8_000;
const CUT = '\n\n_Cut short to fit in a link. The whole ticket is in the Klipp chat._';

/**
 * GitHub's new-issue page for the repository, filled in, for a user signed in there to submit.
 * A body too long for the address is cut short, with a note saying so.
 */
export function newIssueLink(repo: string, draft: IssueDraft, labels: string[] = []): string {
  const { url, path } = parseRepo(repo);
  const link = (body: string) => {
    const query = new URLSearchParams({ title: draft.title, body });
    if (labels.length) query.set('labels', labels.join(','));
    return `${url.origin}/${path}/issues/new?${query}`;
  };
  if (link(draft.body).length <= MAX_LINK) return link(draft.body);
  // The longest start of the body, by whole characters, whose link fits with the note.
  const chars = Array.from(draft.body);
  const fits = (n: number) => link(chars.slice(0, n).join('') + CUT).length <= MAX_LINK;
  let [low, high] = [0, chars.length];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return link(chars.slice(0, low).join('') + CUT);
}

/** Files the issue and returns its address. */
export async function fileGitHubIssue(
  repo: string,
  draft: IssueDraft,
  token: string,
  labels: string[] = [],
  attachments: Screenshot[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let body = draft.body;
  if (attachments.length) {
    const endpoint = issuesEndpoint(repo).replace(/\/issues$/, '');
    const request = async (path: string, method = 'GET', value?: object) => {
      const r = await fetchImpl(`${endpoint}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'klipp',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(value ? { body: JSON.stringify(value) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      return { response: r, value: (await r.json()) as Record<string, unknown> };
    };
    const branch = 'klipp-attachments';
    const ref = await request(`/git/ref/heads/${branch}`);
    if (ref.response.status === 404) {
      const repository = await request('');
      if (!repository.response.ok || typeof repository.value.default_branch !== 'string')
        throw new Error('Cannot find the attachment branch base.');
      const base = await request(
        `/git/ref/heads/${encodeURIComponent(repository.value.default_branch)}`,
      );
      const sha = (base.value.object as { sha?: string } | undefined)?.sha;
      if (!base.response.ok || !sha) throw new Error('Cannot find the attachment branch base.');
      const made = await request('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha });
      if (!made.response.ok) {
        // Another issue may have created it while these reads yielded.
        const raced = await request(`/git/ref/heads/${branch}`);
        if (!raced.response.ok) throw new Error('Cannot create the attachment branch.');
      }
    } else if (!ref.response.ok) throw new Error('Cannot read the attachment branch.');
    for (const image of attachments) {
      const path = `screenshots/${randomUUID()}.${image.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`;
      const uploaded = await request(`/contents/${path}`, 'PUT', {
        message: 'Add approved Klipp screenshot',
        content: image.data,
        branch,
      });
      const sha = (uploaded.value.commit as { sha?: string } | undefined)?.sha;
      if (!uploaded.response.ok || !sha) throw new Error('Cannot upload the approved screenshot.');
      const { url, path: repoPath } = parseRepo(repo);
      body += `\n\n![Approved Klipp screenshot](${url.origin}/${repoPath}/blob/${sha}/${path}?raw=true)`;
    }
  }
  const response = await fetchImpl(issuesEndpoint(repo), {
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
      body,
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
