/** What a section of the page gives the app: its node, and how to stop listening when left. */
export interface View {
  node: HTMLElement;
  stop?(): void;
}

async function problem(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { 'X-Klipp': '1' } });
  if (!response.ok) throw new Error(await problem(response));
  return (await response.json()) as T;
}

export async function send<T = unknown>(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const response = await fetch(path, {
    method,
    headers: {
      'X-Klipp': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(await problem(response));
  return response.status === 204 ? undefined : ((await response.json()) as T);
}

/** Server-sent events as JSON. Closing stops the browser reconnecting once the stream ends. */
export function listen<T>(
  path: string,
  onMessage: (value: T, close: () => void) => void,
): () => void {
  const source = new EventSource(path);
  const close = () => source.close();
  source.onmessage = (event: MessageEvent<string>) => onMessage(JSON.parse(event.data) as T, close);
  return close;
}
