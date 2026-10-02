import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileGitHubIssue, githubToken, issuesEndpoint } from './github.js';

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
