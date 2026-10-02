import { describe, expect, it } from 'vitest';
import { claude, codex, onPath, type RunSpec } from './agents.js';

const spec: RunSpec = {
  root: '/repo',
  system: 'You are Klipp.',
  message: 'hi',
  newSession: '11111111-1111-1111-1111-111111111111',
  mcpUrl: 'http://127.0.0.1:4000/mcp/c1',
  mcpToken: 'secret',
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
    expect(args.join(' ')).not.toMatch(/Bash|Edit|Write|bypassPermissions|dangerously/);
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]!) as {
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
    expect(settings.permissions.deny).toContain('Read(**/.env)');
  });

  it('starts a session with a chosen id and resumes it after', () => {
    expect(args[args.indexOf('--session-id') + 1]).toBe(spec.newSession);
    const resumed = claude.args({ ...spec, session: 'abc' });
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('abc');
    expect(resumed).not.toContain('--session-id');
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

describe('onPath', () => {
  it('finds commands on PATH and absolute paths that exist', () => {
    expect(onPath('node')).toBe(true);
    expect(onPath(process.execPath)).toBe(true);
    expect(onPath('no-such-command-klipp')).toBe(false);
    expect(onPath('/no/such/file')).toBe(false);
  });
});
