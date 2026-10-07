import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBox, type BoxAudit, type BoxServer } from './server.js';
const token = 'issues-test-token-0123456789';
const draft = {
  id: 'proposal-1',
  repo: 'https://github.com/acme/app',
  title: 'Broken button',
  body: 'The button does not work.',
  labels: ['bug'],
  attachments: [],
};
const image = { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1, height: 1 };
let box: BoxServer;
afterEach(async () => {
  await box?.close();
});
async function setup(signedIn = true, fail = false) {
  const data = mkdtempSync(join(tmpdir(), 'klipp-issues-'));
  mkdirSync(join(data, 'github'));
  if (signedIn) writeFileSync(join(data, 'github', 'fake-login'), 'gho_fake_secret');
  const audit: BoxAudit[] = [];
  const http = vi.fn<typeof fetch>((url, options) => {
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer gho_fake_secret' });
    const path = new URL(url instanceof Request ? url.url : url.toString()).pathname;
    if (fail) throw new Error('gho_fake_secret must not leak in an error');
    if (path.endsWith('/issues'))
      return Promise.resolve(Response.json({ html_url: 'https://github.com/acme/app/issues/7' }));
    if (path.includes('/contents/'))
      return Promise.resolve(Response.json({ commit: { sha: 'commit123' } }));
    if (path.endsWith('/git/ref/heads/klipp-attachments'))
      return Promise.resolve(Response.json({}, { status: 404 }));
    if (path.endsWith('/git/refs')) return Promise.resolve(Response.json({}, { status: 201 }));
    if (path.endsWith('/git/ref/heads/main'))
      return Promise.resolve(Response.json({ object: { sha: 'base123' } }));
    return Promise.resolve(Response.json({ default_branch: 'main' }));
  });
  box = await startBox({
    root: process.cwd(),
    data,
    port: 0,
    tokens: `app=${token},other=other-issues-token-012345`,
    githubCommand: [
      process.execPath,
      fileURLToPath(new URL('../../test/fake-gh.mjs', import.meta.url)),
    ],
    githubFetch: http,
    audit: (entry) => audit.push(entry),
  });
  const post = (body: unknown = draft, bearer = token) =>
    fetch(`${box.url}/v1/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { data, audit, http, post };
}
describe('/v1/issues', () => {
  it('requires a box token, validates requests, and gives an explicit signed-out fallback', async () => {
    const { post, http } = await setup(false);
    expect((await post(draft, 'wrong')).status).toBe(401);
    for (const change of [
      { repo: 'https://evil.test/acme/app' },
      { repo: 'https://github.com/acme/../app' },
      { attachments: [{ ...image, mimeType: 'image/svg+xml' }] },
      { attachments: [image, image, image, image] },
      { title: '' },
      { id: '../escape' },
    ])
      expect((await post({ ...draft, ...change })).status).toBe(400);
    const signedOut = await post();
    expect(signedOut.status).toBe(409);
    expect(await signedOut.json()).toMatchObject({ code: 'github_signed_out' });
    expect(http).not.toHaveBeenCalled();
  });
  it('uploads approved screenshots to a dedicated branch and embeds immutable links before filing', async () => {
    const { post, http, data, audit } = await setup();
    const issue = { ...draft, attachments: [image] };
    const results = await Promise.all([post(issue), post(issue)]);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    const filed = await post(issue);
    expect(await filed.json()).toEqual({ url: 'https://github.com/acme/app/issues/7' });
    const requests = http.mock.calls.map(([url, options]) => ({
      url: url instanceof Request ? url.url : url.toString(),
      method: options?.method,
      body:
        typeof options?.body === 'string'
          ? (JSON.parse(options.body) as Record<string, unknown>)
          : undefined,
    }));
    expect(requests.find((r) => r.url.endsWith('/git/refs'))?.body).toEqual({
      ref: 'refs/heads/klipp-attachments',
      sha: 'base123',
    });
    expect(requests.find((r) => r.url.includes('/contents/'))?.body).toMatchObject({
      content: image.data,
      branch: 'klipp-attachments',
    });
    expect(requests.filter((r) => r.url.endsWith('/issues'))).toHaveLength(1);
    expect(requests.at(-1)?.body).toMatchObject({
      title: draft.title,
      labels: ['bug'],
      body: expect.stringMatching(/blob\/commit123\/screenshots\/.*\.jpg\?raw=true/),
    });
    expect(audit).toEqual([
      { user: 'app', action: 'issue.filed', target: 'https://github.com/acme/app/issues/7' },
    ]);
    expect(readFileSync(join(data, 'issues.json'), 'utf8')).not.toContain('gho_');
    expect(statSync(join(data, 'issues.json')).mode & 0o777).toBe(0o600);
    const callsBeforeRestart = http.mock.calls.length;
    await box.close();
    box = await startBox({
      root: process.cwd(),
      data,
      port: 0,
      tokens: `app=${token}`,
      githubCommand: [
        process.execPath,
        fileURLToPath(new URL('../../test/fake-gh.mjs', import.meta.url)),
      ],
      githubFetch: http,
    });
    expect((await post(issue)).status).toBe(200);
    expect(http).toHaveBeenCalledTimes(callsBeforeRestart);
    expect(requests.filter((r) => r.url.endsWith('/issues'))).toHaveLength(1);
    expect((await post({ ...issue, title: 'Changed' })).status).toBe(409);
  });
  it('never repeats a consumed issue after an ambiguous failure, and hides secrets', async () => {
    const { post, http } = await setup(true, true);
    const failed = await post();
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('gho_fake_secret');
    expect((await post()).status).toBe(409);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('namespaces proposal receipts by app', async () => {
    const { post, http } = await setup();
    expect((await post()).status).toBe(200);
    expect((await post(draft, 'other-issues-token-012345')).status).toBe(200);
    expect(http).toHaveBeenCalledTimes(2);
  });
});
