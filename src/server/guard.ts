import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Names that only ever point at this machine. Anything else could be rebound or tunnelled. */
const LOCAL_HOST = /^(?:localhost|(?:[a-z0-9-]+\.)+localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/** Set by tunnels and reverse proxies, which connect from loopback on someone else's behalf. */
const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via'];

/** The address the browser asked for: `Host`, or `:authority` over HTTP/2. */
export function hostOf(req: IncomingMessage): string | undefined {
  const host = req.headers.host ?? req.headers[':authority'];
  return typeof host === 'string' && host ? host.toLowerCase() : undefined;
}

/**
 * A request from a browser on this machine, to a local address, not relayed. The name matters
 * as much as the socket: a page that rebinds its own name to 127.0.0.1 also arrives from
 * loopback, and a tunnel connects from loopback too.
 */
export function isLocal(req: IncomingMessage): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return false;
  if (FORWARDED.some((name) => req.headers[name] !== undefined)) return false;
  return LOCAL_HOST.test(hostOf(req) ?? '');
}

/**
 * Sent by Klipp's runtime from the page itself: with Klipp's header, which a cross-site form
 * can't add, and an `Origin` (when there is one) naming the address the request went to.
 */
export function fromKlipp(req: IncomingMessage): boolean {
  if (req.headers['x-klipp'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== hostOf(req)) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

/** No 0/O or 1/I/L, so a code read off a terminal is typed right the first time. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const COOKIE = 'klipp_pair';
const MAX_FAILURES = 20;

const digest = (text: string) => createHash('sha256').update(text).digest();

/**
 * Lets other devices in when `allowRemote` is on, the way Jupyter does: the dev server prints a
 * code, a device that sends it once gets a cookie, and requests without the cookie are refused.
 * After too many wrong codes, pairing stops until the dev server restarts.
 */
export class Pairing {
  readonly code: string;
  private readonly sessions = new Set<string>();
  private failures = 0;

  /** @param code a fixed code, such as a shared test environment's; at least 10 characters. */
  constructor(code?: string) {
    if (code !== undefined && code.trim().length < 10) {
      throw new Error('[klipp] chat.pairingCode needs at least 10 characters.');
    }
    this.code =
      code?.trim().toUpperCase() ??
      Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  }

  /** Whether the request carries a cookie from an earlier pairing. */
  paired(req: IncomingMessage): boolean {
    const cookies = (req.headers.cookie ?? '').split(';').map((part) => part.trim());
    return cookies.some(
      (cookie) =>
        cookie.startsWith(`${COOKIE}=`) && this.sessions.has(cookie.slice(COOKIE.length + 1)),
    );
  }

  /** The `Set-Cookie` value for a right code; undefined for a wrong one or when locked. */
  pair(code: unknown, req: IncomingMessage): string | undefined {
    if (this.failures >= MAX_FAILURES || typeof code !== 'string') return undefined;
    const given = code.trim().toUpperCase();
    if (!timingSafeEqual(digest(given), digest(this.code))) {
      this.failures++;
      return undefined;
    }
    const session = randomBytes(32).toString('hex');
    this.sessions.add(session);
    const secure = (req.socket as Partial<TLSSocket>).encrypted ? '; Secure' : '';
    return `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }

  get locked(): boolean {
    return this.failures >= MAX_FAILURES;
  }
}
