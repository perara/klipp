import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileGitHubIssue, githubToken, issuesEndpoint, newIssueLink } from './github.js';

describe('githubToken', () => {
  const env = { GITHUB_TOKEN: 'ghp_public', GH_ENTERPRISE_TOKEN: 'ghe_token' };
  const logins: string[] = [];
  const login = (host: string) => {
    logins.push(host);
    return host === 'ghe.example.com' ? 'gh_cli_ghe' : undefined;
  };

  it('uses the github.com token only for github.com', () => {
    expect(githubToken('https://github.com/acme/app', env, login)).toBe('ghp_public');
  });

  it('gives an Enterprise host its own token when GH_HOST names it, else the CLI login', () => {
    const host = 'ghe.example.com';
    expect(githubToken(`https://${host}/team/app`, { ...env, GH_HOST: host }, login)).toBe(
      'ghe_token',
    );
    expect(githubToken(`https://${host}/team/app`, env, login)).toBe('gh_cli_ghe');
  });

  it('has none for github.com without a token or a login, so the user submits it there', () => {
    expect(githubToken('https://github.com/acme/app', {}, login)).toBeUndefined();
  });

  it('sends no token to a host that is not GitHub', () => {
    logins.length = 0;
    expect(() => githubToken('https://gitlab.com/group/project', env, login)).toThrow(
      /no login for gitlab\.com/,
    );
    expect(logins).toEqual(['gitlab.com']);
  });
});

describe('issuesEndpoint', () => {
  it('uses the API host for github.com and the server itself for Enterprise, port and all', () => {
    expect(issuesEndpoint('https://github.com/acme/app')).toBe(
      'https://api.github.com/repos/acme/app/issues',
    );
    expect(issuesEndpoint('https://ghe.example.com:8443/team/app')).toBe(
      'https://ghe.example.com:8443/api/v3/repos/team/app/issues',
    );
    expect(() => issuesEndpoint('https://github.com/acme')).toThrow(/not a repository/);
  });
});

describe('newIssueLink', () => {
  const draft = {
    title: 'Save & quit #2 fails',
    body: '**Bug** · 50% of the time\n\n| a | b |\n😀',
  };

  it("fills in GitHub's new-issue page: title, body and labels, encoded", () => {
    const link = newIssueLink('https://github.com/acme/app', draft, ['bug', 'klipp']);
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/acme/app/issues/new');
    expect(link).not.toMatch(/[ #|😀]/u);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...draft, labels: 'bug,klipp' });
  });

  it('sets no labels when there are none, and keeps an Enterprise host', () => {
    const url = new URL(newIssueLink('https://ghe.example.com:8443/team/app', draft));
    expect(url.origin).toBe('https://ghe.example.com:8443');
    expect(url.searchParams.has('labels')).toBe(false);
  });

  it('cuts a body too long for a link short, by whole characters, and says so', () => {
    const body = `${'😀 | a & b\n'.repeat(2_000)}the end`;
    const link = newIssueLink('https://github.com/acme/app', { title: 'Long', body }, ['bug']);
    expect(link.length).toBeLessThanOrEqual(8_000);
    expect(link.length).toBeGreaterThan(7_900);
    const sent = new URL(link).searchParams.get('body')!;
    const [kept, note] = sent.split('\n\n_');
    expect(body.startsWith(kept!)).toBe(true);
    expect(kept).not.toMatch(/\uFFFD/);
    expect(note).toBe('Cut short to fit in a link. The whole ticket is in the Klipp chat._');
  });
});

describe('fileGitHubIssue', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
    );
  const draft = { title: 'Broken', body: 'It is.' };

  it('returns the address GitHub gives', async () => {
    answer(201, { html_url: 'https://github.com/acme/app/issues/7' });
    await expect(fileGitHubIssue('https://github.com/acme/app', draft, 't', ['bug'])).resolves.toBe(
      'https://github.com/acme/app/issues/7',
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/app/issues');
    expect(JSON.parse(init!.body as string)).toEqual({ ...draft, labels: ['bug'] });
  });

  it("says what GitHub said, and won't pass on an address that isn't https", async () => {
    answer(403, { message: 'Resource not accessible by integration' });
    await expect(fileGitHubIssue('https://github.com/acme/app', draft, 't')).rejects.toThrow(
      'GitHub answered 403: Resource not accessible by integration',
    );
    answer(201, { html_url: 'javascript:alert(1)' });
    await expect(fileGitHubIssue('https://github.com/acme/app', draft, 't')).rejects.toThrow(
      /no address/,
    );
  });
});
