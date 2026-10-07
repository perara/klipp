import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boxOptionsFromEnv } from './env.js';
import { startBox, type BoxAudit, type BoxServer } from './server.js';

const TOKEN = 'smia-test-token-0123456789';
const owner = { 'X-Klipp-Box-User': 'Owner@Example.com', 'X-Klipp-Box-Roles': 'tester, ai-box' };
const ui = { ...owner, 'X-Klipp': '1', Origin: 'https://box.example.com' };
const data = mkdtempSync(join(tmpdir(), 'smia-identity-'));
const audit: BoxAudit[] = [];
let box: BoxServer;

/** Real HTTP, including duplicate wire headers that fetch would merge before sending. */
function call(
  path: string,
  headers: Record<string, string | string[]> = {},
  method = 'GET',
  body?: unknown,
  url = box.url,
) {
  return new Promise<{ status: number; text: string }>((done, fail) => {
    const req = request(
      `${url}${path}`,
      {
        method,
        headers: { Host: 'box.example.com', 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => done({ status: res.statusCode!, text }));
      },
    );
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

beforeAll(async () => {
  const fake = [process.execPath, join(process.cwd(), 'test/fake-agent.mjs')];
  box = await startBox({
    root: process.cwd(),
    data,
    port: 0,
    identity: {
      header: 'X-Klipp-Box-User',
      rolesHeader: 'X-Klipp-Box-Roles',
      requiredRole: 'ai-box',
    },
    publicHost: 'BOX.EXAMPLE.COM',
    tokens: `test=${TOKEN}`,
    commands: { claude: fake, codex: fake },
    audit: (entry) => audit.push(entry),
  });
});
afterAll(async () => {
  await box.close();
  rmSync(data, { recursive: true, force: true });
});

describe('Smia behind a sign-in proxy', () => {
  it('authenticates pages, every asset and every UI endpoint, including streams', async () => {
    for (const path of [
      '/',
      '/ui/box/ui/app.js',
      '/ui/box/ui/assets/nunito.woff2',
      '/ui/api/agents',
      '/ui/api/tokens',
      '/ui/api/runs',
      '/ui/api/logins/any',
      '/ui/anything',
    ]) {
      expect((await call(path)).status).toBe(401);
      expect((await call(path, { 'x-klipp-box-user': 'outsider@example.com' })).status).toBe(403);
    }
    const missing = await call('/');
    expect(missing.text).toContain('Sign-in required');
    expect((await call('/', { 'x-klipp-box-user': 'outsider@example.com' })).text).toContain(
      'Access denied',
    );
    expect((await call('/', owner)).status).toBe(200);
    expect(JSON.parse((await call('/ui/api/session', owner)).text)).toEqual({
      user: 'owner@example.com',
    });
  });

  it('requires an exact case-sensitive role in a strictly parsed single header', async () => {
    for (const value of ['ai-box', 'tester, ai-box', ' ai-box , admin ']) {
      expect((await call('/', { ...owner, 'X-Klipp-Box-Roles': value })).status).toBe(200);
    }
    for (const value of [
      '',
      'tester',
      'AI-BOX',
      'ai-box-admin',
      'ai-box,',
      ',ai-box',
      'ai-box,,admin',
      'ai-box;admin',
      'ai-box, ai-box',
      'ai-box, bad role',
      ['ai-box', 'ai-box'],
      ['tester', 'ai-box'],
    ]) {
      expect((await call('/', { ...owner, 'X-Klipp-Box-Roles': value })).status).toBe(403);
    }
    expect((await call('/', { 'X-Klipp-Box-User': 'owner@example.com' })).status).toBe(403);
    expect(
      (
        await call('/ui/api/session', {
          'x-KLIPP-box-USER': 'anyone@example.com',
          'x-KLIPP-box-ROLES': 'ai-box',
        })
      ).status,
    ).toBe(200);
  });

  it('rejects empty, malformed, lists and duplicate headers, even identical duplicates', async () => {
    for (const value of [
      '',
      'owner',
      'owner@example.com,person@team.example.com',
      'owner@example.com; person@team.example.com',
      '<owner@example.com>',
      ['owner@example.com', 'owner@example.com'],
      ['owner@example.com', 'other@example.com'],
    ]) {
      expect((await call('/', { 'x-klipp-box-user': value })).status).toBe(401);
    }
    expect((await call('/', { ...owner, 'x-klipp-box-user': 'bad value' })).status).toBe(401);
  });

  it('accepts only localhost names and the configured public host, with HTTPS public origins and CSRF protection', async () => {
    for (const Host of [
      'box.example.com',
      'BOX.EXAMPLE.COM',
      'box.example.com:443',
      'localhost:9000',
      '127.0.0.1:9000',
      '[::1]:9000',
    ]) {
      expect((await call('/', { ...owner, Host })).status).toBe(200);
    }
    for (const Host of [
      'evil.example.com',
      'box.example.com.evil.org',
      'box.example.com:9000',
      'x.localhost',
    ]) {
      expect((await call('/', { ...owner, Host })).status).toBe(403);
    }
    for (const Origin of [
      'https://evil.example.com',
      'http://box.example.com',
      'https://box.example.com.evil.org',
      'null',
      'https://box.example.com/path',
    ]) {
      expect(
        (await call('/ui/api/tokens', { ...ui, Origin }, 'POST', { name: 'refused' })).status,
      ).toBe(403);
    }
    expect((await call('/ui/api/tokens', owner, 'POST', { name: 'refused' })).status).toBe(403);
    expect(
      (
        await call('/ui/api/tokens', { ...ui, 'Sec-Fetch-Site': 'cross-site' }, 'POST', {
          name: 'refused',
        })
      ).status,
    ).toBe(403);
    expect((await call('/ui/api/tokens', { ...owner, 'Sec-Fetch-Site': 'same-site' })).status).toBe(
      403,
    );
    expect((await call('/ui/api/tokens', ui, 'POST', { name: 'allowed' })).status).toBe(200);
    expect((await call('/ui/api/tokens/allowed', ui, 'DELETE')).status).toBe(204);
    expect(
      (
        await call(
          '/ui/api/tokens',
          { ...ui, Host: 'localhost:9000', Origin: 'http://localhost:9000' },
          'POST',
          { name: 'local' },
        )
      ).status,
    ).toBe(200);
  });

  it('leaves protocol v1 bearer-only, independent of identity and public host settings', async () => {
    for (const path of ['/v1/agents', '/v1/runs', '/v1/runs/any/tools/any']) {
      expect((await call(path, owner, path === '/v1/agents' ? 'GET' : 'POST')).status).toBe(401);
    }
    expect(
      (await call('/v1/agents', { Authorization: `Bearer ${TOKEN}`, Host: 'any.example.com' }))
        .status,
    ).toBe(200);
    expect((await call('/v1/agents', { ...owner, Authorization: 'Bearer wrong' })).status).toBe(
      401,
    );
    expect((await call('/healthz')).status).toBe(200);
  });

  it('logs successful changes and completed agent sign-ins with the initiator, never secrets', async () => {
    const before = audit.length;
    const made = await call('/ui/api/tokens', ui, 'POST', { name: 'audited' });
    expect(made.status).toBe(200);
    expect((await call('/ui/api/tokens/audited', ui, 'DELETE')).status).toBe(204);
    expect((await call('/ui/api/tokens/missing', ui, 'DELETE')).status).toBe(404);
    expect((await call('/ui/api/agents/codex/login', ui, 'POST')).status).toBe(200);
    await vi.waitFor(() =>
      expect(audit).toContainEqual({
        user: 'owner@example.com',
        action: 'agent.login.done',
        target: 'codex',
      }),
    );
    expect((await call('/ui/api/agents/codex/logout', ui, 'POST')).status).toBe(204);
    expect(audit.slice(before)).toEqual([
      { user: 'owner@example.com', action: 'token.create', target: 'audited' },
      { user: 'owner@example.com', action: 'token.revoke', target: 'audited' },
      { user: 'owner@example.com', action: 'agent.login.start', target: 'codex' },
      { user: 'owner@example.com', action: 'agent.login.done', target: 'codex' },
      { user: 'owner@example.com', action: 'agent.logout', target: 'codex' },
    ]);
    expect(JSON.stringify(audit)).not.toContain((JSON.parse(made.text) as { token: string }).token);
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
  });
  it('keeps the initiator on a shared login and audits a different owner cancelling it', async () => {
    const before = audit.length;
    const first = await call('/ui/api/agents/claude/login', ui, 'POST');
    const other = { ...ui, 'X-Klipp-Box-User': 'second@example.com' };
    const joined = await call('/ui/api/agents/claude/login', other, 'POST');
    expect(joined.text).toBe(first.text);
    const { login } = JSON.parse(first.text) as { login: string };
    expect((await call(`/ui/api/logins/${login}`, other, 'DELETE')).status).toBe(204);
    expect(audit.slice(before)).toEqual([
      { user: 'owner@example.com', action: 'agent.login.start', target: 'claude' },
      { user: 'owner@example.com', action: 'agent.login.failed', target: 'claude' },
      { user: 'second@example.com', action: 'agent.login.cancel', target: 'claude' },
    ]);
    const after = audit.length;
    expect(
      (
        await call('/ui/api/tokens', { ...ui, 'X-Klipp-Box-Roles': 'tester' }, 'POST', {
          name: 'denied',
        })
      ).status,
    ).toBe(403);
    expect(audit.length).toBe(after);
  });
});

it('refuses incomplete or ambiguous identity configuration before creating data or listening', async () => {
  const unused = join(data, 'must-not-create');
  const valid = {
    KLIPP_BOX_IDENTITY_HEADER: 'x-user',
    KLIPP_BOX_ROLES_HEADER: 'x-roles',
    KLIPP_BOX_REQUIRED_ROLE: 'ai-box',
  };
  for (const requiredRole of [undefined, '', ' ', '*', 'ai-box,admin', 'ai box']) {
    const options = boxOptionsFromEnv({ ...valid, KLIPP_BOX_REQUIRED_ROLE: requiredRole }, '/repo');
    await expect(startBox({ ...options, port: 0, data: unused })).rejects.toThrow(
      /KLIPP_BOX_REQUIRED_ROLE/,
    );
    expect(existsSync(unused)).toBe(false);
  }
  for (const rolesHeader of [undefined, '', 'x-user', 'Authorization', 'X-Klipp', 'bad header']) {
    const options = boxOptionsFromEnv({ ...valid, KLIPP_BOX_ROLES_HEADER: rolesHeader }, '/repo');
    await expect(startBox({ ...options, port: 0, data: unused })).rejects.toThrow(
      /KLIPP_BOX_ROLES_HEADER/,
    );
    expect(existsSync(unused)).toBe(false);
  }
  for (const identityHeader of ['', 'Host', 'Authorization', 'Origin', 'X-Klipp', 'bad header']) {
    const options = boxOptionsFromEnv(
      { ...valid, KLIPP_BOX_IDENTITY_HEADER: identityHeader },
      '/repo',
    );
    await expect(startBox({ ...options, port: 0, data: unused })).rejects.toThrow(
      /KLIPP_BOX_IDENTITY_HEADER/,
    );
  }
  await expect(
    startBox({ root: '/repo', data: unused, port: 0, publicHost: 'box.example.com' }),
  ).rejects.toThrow(/requires/);
  for (const publicHost of [
    'https://box.example.com',
    'box.example.com/path',
    'box.example.com:443',
  ]) {
    await expect(
      startBox({ ...boxOptionsFromEnv(valid, '/repo'), data: unused, port: 0, publicHost }),
    ).rejects.toThrow(/PUBLIC_HOST/);
  }
});

it('ignores identity and role headers when not configured, keeping the local UI and v1 guards', async () => {
  const local = await startBox({
    root: process.cwd(),
    data: join(data, 'local'),
    port: 0,
    tokens: `test=${TOKEN}`,
  });
  try {
    const session = await fetch(`${local.url}/ui/api/session`, { headers: owner });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ user: null });
    expect(
      (await call('/', { ...owner, Host: 'box.example.com' }, 'GET', undefined, local.url)).status,
    ).toBe(403);
    expect((await fetch(`${local.url}/v1/agents`, { headers: owner })).status).toBe(401);
    expect(
      (
        await fetch(`${local.url}/ui/api/tokens`, {
          method: 'POST',
          headers: { ...owner, 'Content-Type': 'application/json' },
          body: '{"name":"refused"}',
        })
      ).status,
    ).toBe(403);
  } finally {
    await local.close();
  }
});
