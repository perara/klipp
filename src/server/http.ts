import type { IncomingMessage, ServerResponse } from 'node:http';

export function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** What is wrong with a request, as opposed to a failure on the server's side. */
export class RequestError extends Error {}

export async function readJson(
  req: IncomingMessage,
  limit = 1_000_000,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new RequestError('too large');
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new RequestError((error as Error).message);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}
