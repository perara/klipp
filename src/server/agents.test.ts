import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { childEnv, claude, codex, codexInstall, onPath, type RunSpec } from './agents.js';

const spec: RunSpec = {
  root: '/repo',
  dir: '/tmp/klipp-run-1',
  system: 'You are Klipp.',
  message: 'hi',
  newSession: '11111111-1111-1111-1111-111111111111',
  mcpUrl: 'http://127.0.0.1:4000/mcp/c1',
  mcpToken: 'secret',
  install: ['/opt/codex'],
  tools: [{ name: 'point_at_element', description: 'Point.', inputSchema: { type: 'object' } }],
};

const lines = (parse: (line: string) => unknown[], events: object[]) =>
  events.flatMap((e) => parse(JSON.stringify(e)));

describe('claude', () => {
  const args = claude.args(spec);

  it('runs headless, restricted to reading, with only Klipp as an MCP server', () => {
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'stream-json']);
    expect(args).toContain('--restricted');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args.join(' ')).not.toMatch(/Bash|Edit|Write|bypassPermissions|dangerously|secret/);
    // The token goes in a private file, out of the process list.
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/tmp/klipp-run-1/mcp.json');
    const mcp = JSON.parse(claude.files!(spec)['mcp.json']!) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual(['klipp']);
    expect(mcp.mcpServers.klipp).toEqual({
      type: 'http',
      url: spec.mcpUrl,
      headers: { Authorization: 'Bearer secret' },
    });
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Read(**/.env)', 'Read(**/.envrc)', 'Read(.git/config)']),
    );
  });

  it('starts a session with a chosen id and resumes it after', () => {
    expect(args[args.indexOf('--session-id') + 1]).toBe(spec.newSession);
    const resumed = claude.args({ ...spec, session: 'abc' });
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('abc');
    expect(resumed).not.toContain('--session-id');
  });

  it('allows exactly the tools the run was given', () => {
    expect(args.slice(args.indexOf('--allowedTools') + 1)).toEqual([
      'Read',
      'Grep',
      'Glob',
      'mcp__klipp__point_at_element',
    ]);
  });

  it('turns its stream into session, text, activity and the end', () => {
    expect(
      lines(claude.parser('/repo'), [
        { type: 'system', subtype: 'init', session_id: 's1' },
        { type: 'stream_event', event: { type: 'message_start' } },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Let me look.' },
          },
        },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/App.tsx' } },
            ],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'mcp__klipp__point_at_element', input: {} }],
          },
        },
        { type: 'stream_event', event: { type: 'message_start' } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Found it.' } },
        },
        { type: 'result', subtype: 'success', is_error: false, result: 'Found it.' },
      ]),
    ).toEqual([
      { type: 'session', id: 's1' },
      { type: 'text', delta: 'Let me look.' },
      { type: 'activity', label: 'Reading src/App.tsx' },
      { type: 'break' },
      { type: 'text', delta: 'Found it.' },
      { type: 'done' },
    ]);
  });

  it('skips lines that are not what it expects', () => {
    expect(
      lines(claude.parser('/repo'), [
        { type: 'stream_event' },
        { type: 'stream_event', event: null },
        { type: 'assistant', message: { content: [null, 3, { type: 'tool_use' }] } },
        { type: 'assistant', message: 'hi' },
        { type: 'result', is_error: true, result: { nested: true } },
      ]),
    ).toEqual([{ type: 'error', message: 'Claude stopped with an error.' }]);
    expect(claude.parser('/repo')('not json')).toEqual([]);
  });

  it('points at the login when authentication fails', () => {
    const [event] = lines(claude.parser('/repo'), [
      { type: 'result', is_error: true, result: 'Failed to authenticate: OAuth session expired' },
    ]) as Array<{ type: string; message: string }>;
    expect(event!.type).toBe('error');
    expect(event!.message).toContain('Run `claude` in a terminal and log in');
  });
});

describe('codex', () => {
  it('runs in a read-only sandbox, never asking, with only Klipp tools approved', () => {
    const args = codex.args(spec);
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('sandbox_mode="read-only"');
    // Reads only the repository, the system files programs need, and Codex itself.
    expect(args).toContain('default_permissions="klipp"');
    expect(args).toContain(
      'permissions.klipp.filesystem={":minimal"="read", ":workspace_roots"="read", "/opt/codex"="read"}',
    );
    expect(args).toContain('shell_environment_policy.inherit="core"');
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('mcp_servers.klipp.default_tools_approval_mode="approve"');
    expect(args).toContain(`mcp_servers.klipp.url="${spec.mcpUrl}"`);
    expect(args.join(' ')).not.toMatch(/danger|workspace-write|secret/);
    expect(codex.env(spec)).toEqual({ KLIPP_MCP_TOKEN: 'secret' });
    expect(args.at(-1)).toBe('-');
  });

  it('resumes its thread', () => {
    expect(codex.args({ ...spec, session: 't1' }).slice(0, 4)).toEqual([
      'exec',
      'resume',
      't1',
      '--json',
    ]);
  });

  it('turns its events into session, activity, messages and the end', () => {
    expect(
      lines(codex.parser('/repo'), [
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Looking.' } },
        {
          type: 'item.started',
          item: { type: 'command_execution', command: "/usr/bin/bash -lc 'rg -n Save src'" },
        },
        { type: 'item.started', item: { type: 'mcp_tool_call', tool: 'point_at_element' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Found it.' } },
        { type: 'turn.completed', usage: {} },
      ]),
    ).toEqual([
      { type: 'session', id: 't1' },
      { type: 'text', delta: 'Looking.' },
      { type: 'activity', label: 'Running rg -n Save src' },
      { type: 'break' },
      { type: 'text', delta: 'Found it.' },
      { type: 'done' },
    ]);
  });

  it('points at the login when the turn fails for want of one', () => {
    const [event] = lines(codex.parser('/repo'), [
      { type: 'turn.failed', error: { message: '401 Unauthorized' } },
    ]) as Array<{
      message: string;
    }>;
    expect(event!.message).toBe(
      '401 Unauthorized Run `codex login` in a terminal, then try again.',
    );
  });
});

describe('childEnv', () => {
  it("passes what the agent needs to start and log in, and nothing of the dev server's own", () => {
    const env = {
      PATH: '/bin',
      HOME: '/home/me',
      LC_ALL: 'C',
      HTTPS_PROXY: 'http://proxy',
      ANTHROPIC_API_KEY: 'a',
      CLAUDE_CONFIG_DIR: 'c',
      OPENAI_API_KEY: 'o',
      CODEX_HOME: 'x',
      DATABASE_URL: 'postgres://secret',
      ANTHROPIC_BASE_URL: '',
      GITHUB_TOKEN: 'ghp',
      MY_EXTRA: 'yes',
    };
    expect(Object.keys(childEnv(claude, env)).sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'CLAUDE_CONFIG_DIR',
      'HOME',
      'HTTPS_PROXY',
      'LC_ALL',
      'PATH',
    ]);
    expect(Object.keys(childEnv(codex, env, ['MY_EXTRA'])).sort()).toEqual([
      'CODEX_HOME',
      'HOME',
      'HTTPS_PROXY',
      'LC_ALL',
      'MY_EXTRA',
      'OPENAI_API_KEY',
      'PATH',
    ]);
  });
});

describe('codexInstall', () => {
  it('finds the release a standalone install links to, and the packages of an npm install', () => {
    const base = mkdtempSync(join(tmpdir(), 'klipp-install-'));
    const release = join(base, 'releases', '1.0', 'bin');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'codex'), '');
    mkdirSync(join(base, 'bin'));
    symlinkSync(join(release, 'codex'), join(base, 'bin', 'codex'));
    expect(codexInstall('codex', { PATH: join(base, 'bin') })).toEqual([
      join(base, 'releases', '1.0'),
    ]);

    const npm = join(base, 'lib', 'node_modules', '@openai', 'codex', 'bin');
    mkdirSync(npm, { recursive: true });
    writeFileSync(join(npm, 'codex.js'), '');
    expect(codexInstall(join(npm, 'codex.js'), {})).toEqual([
      join(base, 'lib', 'node_modules', '@openai', 'codex'),
      join(base, 'lib', 'node_modules'),
    ]);
    expect(codexInstall('no-such-codex', { PATH: base })).toEqual([]);
  });
});

describe('onPath', () => {
  it('finds commands on PATH and absolute paths that exist', () => {
    expect(onPath('node')).toBe(true);
    expect(onPath(process.execPath)).toBe(true);
    expect(onPath('no-such-command-klipp')).toBe(false);
    expect(onPath('/no/such/file')).toBe(false);
  });
});
