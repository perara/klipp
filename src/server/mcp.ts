import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResult {
  text: string;
  isError?: boolean;
}

/** Runs one tool call for one conversation; may wait as long as the user takes. */
export type McpHandler = (name: string, args: Record<string, unknown>) => Promise<McpResult>;

interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * A minimal MCP server (streamable HTTP, JSON responses) on its own loopback port, through
 * which a background agent CLI calls tools that need the page or the user. Each conversation
 * has its own path; a bearer token keeps other local processes out.
 */
export class McpBridge {
  readonly token = randomBytes(24).toString('hex');
  private readonly handlers = new Map<string, McpHandler>();
  private server: Server | undefined;
  private port = 0;

  constructor(
    private readonly tools: McpTool[],
    private readonly version = '0',
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    server.unref();
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
  }

  url(conversation: string): string {
    return `http://127.0.0.1:${this.port}/mcp/${conversation}`;
  }

  register(conversation: string, handler: McpHandler) {
    this.handlers.set(conversation, handler);
  }

  unregister(conversation: string) {
    this.handlers.delete(conversation);
  }

  close() {
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const conversation = /^\/mcp\/([\w-]+)$/.exec((req.url ?? '').split('?', 1)[0]!)?.[1];
    if (req.headers.authorization !== `Bearer ${this.token}`) return reply(res, 401);
    if (!conversation) return reply(res, 404);
    if (req.method === 'DELETE') return reply(res, 200);
    if (req.method !== 'POST') return reply(res, 405);
    let body: Message | Message[];
    try {
      body = JSON.parse(await readBody(req)) as Message | Message[];
    } catch {
      return reply(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    const messages = Array.isArray(body) ? body : [body];
    const answers = (await Promise.all(messages.map((m) => this.answer(conversation, m)))).filter(
      (a): a is object => a !== undefined,
    );
    if (!answers.length) return reply(res, 202);
    reply(res, 200, Array.isArray(body) ? answers : answers[0]);
  }

  /** The response to one JSON-RPC message; undefined for notifications. */
  private async answer(conversation: string, message: Message): Promise<object | undefined> {
    if (message.id === undefined || message.id === null) return undefined;
    const ok = (result: object) => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code: number, text: string) => ({
      jsonrpc: '2.0',
      id: message.id,
      error: { code, message: text },
    });
    switch (message.method) {
      case 'initialize': {
        const asked = message.params?.protocolVersion;
        return ok({
          protocolVersion:
            typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[1],
          capabilities: { tools: {} },
          serverInfo: { name: 'klipp', version: this.version },
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: this.tools });
      case 'tools/call': {
        const handler = this.handlers.get(conversation);
        const name = String(message.params?.name ?? '');
        if (!handler)
          return ok({
            content: [{ type: 'text', text: 'The page is no longer open.' }],
            isError: true,
          });
        if (!this.tools.some((tool) => tool.name === name))
          return fail(-32602, `Unknown tool ${name}`);
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const result = await handler(name, args);
          return ok({
            content: [{ type: 'text', text: result.text }],
            isError: result.isError ?? false,
          });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return ok({ content: [{ type: 'text', text }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${String(message.method)}`);
    }
  }
}

function reply(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
