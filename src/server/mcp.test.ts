import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpBridge } from './mcp.js';

const bridge = new McpBridge(
  [{ name: 'echo', description: 'Echoes.', inputSchema: { type: 'object', properties: {} } }],
  '1.2.3',
);
const calls: Array<[string, Record<string, unknown>]> = [];

beforeAll(async () => {
  await bridge.start();
  bridge.register('c1', async (name, args) => {
    calls.push([name, args]);
    return { text: `echo ${String(args.word)}` };
  });
});
afterAll(() => bridge.close());

const post = (body: unknown, conversation = 'c1', token = bridge.token) =>
  fetch(bridge.url(conversation), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe('McpBridge', () => {
  it('refuses requests without its token', async () => {
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'c1', 'wrong')).status).toBe(401);
  });

  it('agrees on the protocol version the client asks for, and lists its tools', async () => {
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(await init.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'klipp', version: '1.2.3' },
      },
    });
    const list = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(['echo']);
  });

  it('accepts notifications without a body', async () => {
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  });

  it("routes tool calls to the conversation's handler", async () => {
    const answer = await post({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { word: 'hi' } },
    });
    expect(await answer.json()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'echo hi' }], isError: false },
    });
    expect(calls).toEqual([['echo', { word: 'hi' }]]);
  });

  it('says so when the page has gone, and rejects unknown tools and methods', async () => {
    const gone = await post(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo' } },
      'c2',
    );
    expect(((await gone.json()) as { result: { isError: boolean } }).result.isError).toBe(true);
    const unknown = (await (
      await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })
    ).json()) as {
      error: { code: number };
    };
    expect(unknown.error.code).toBe(-32602);
    const method = (await (
      await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' })
    ).json()) as { error: { code: number } };
    expect(method.error.code).toBe(-32601);
  });

  it('answers a batch with a batch', async () => {
    const answer = await post([
      { jsonrpc: '2.0', id: 7, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(await answer.json()).toEqual([{ jsonrpc: '2.0', id: 7, result: {} }]);
  });
});
