const KEEP = 8;
const errors: string[] = [];
const failed: string[] = [];

function push(list: string[], line: string) {
  list.push(line.length > 300 ? `${line.slice(0, 299)}…` : line);
  if (list.length > KEEP) list.shift();
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Path and query keys of a request, without values. */
function requestPath(name: string): string {
  try {
    const url = new URL(name, location.href);
    const keys = [...new Set(url.searchParams.keys())];
    const host = url.origin === location.origin ? '' : url.host;
    return `${host}${url.pathname}${keys.length ? `?${keys.map((k) => `${k}=…`).join('&')}` : ''}`;
  } catch {
    return name;
  }
}

/**
 * Starts recording console errors, uncaught errors and failed requests, from page load on.
 * Requests are read from the browser's resource timing, so `fetch` itself is left alone.
 */
export function startCapture() {
  const original = console.error;
  console.error = function (this: Console, ...args: unknown[]) {
    push(errors, args.map(describe).join(' '));
    return original.apply(this, args);
  };
  window.addEventListener('error', (event) => {
    const where = event.filename ? ` (${requestPath(event.filename)}:${event.lineno})` : '';
    push(errors, `Uncaught ${event.message}${where}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    push(errors, `Unhandled rejection: ${describe(event.reason)}`);
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        const status = entry.responseStatus ?? 0;
        if (status >= 400 && !entry.name.includes('/@klipp/')) {
          push(failed, `${status} ${requestPath(entry.name)}`);
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {
    // Older browsers: no request failures in the context.
  }
}

export const recentErrors = () => [...errors];
export const failedRequests = () => [...failed];
