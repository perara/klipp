import type { IncomingMessage } from 'node:http';

/**
 * Klipp behind a sign-in proxy, such as an auth gateway in front of a shared test environment:
 * the proxy says who the user is in a header it sets itself, and removes from what browsers
 * send. The chat then answers anyone it names (or the ones listed), instead of only localhost.
 */
export interface IdentityOptions {
  /** The header the proxy sets to the signed-in user, such as `x-klipp-user`. */
  header: string;
  /** Who may use the chat, as the header names them; `'*'` for anyone signed in. Default: `'*'`. */
  allow?: readonly string[] | '*' | undefined;
  /** Messages one user may send per hour; each one runs the agent. Default: 30. */
  messagesPerHour?: number | undefined;
}

/** A user as a proxy names them: an email or an account name, never a list or markup. */
const USER = /^[^\s,;<>"'`\\]{1,254}$/;
const HOUR = 60 * 60 * 1000;

export class Identity {
  private readonly sent = new Map<string, number[]>();

  constructor(private readonly options: IdentityOptions) {}

  /** Who sent the request, or why it may not use the chat. */
  userOf(req: IncomingMessage): { user: string } | { refused: [number, string] } {
    const value = req.headers[this.options.header.toLowerCase()];
    const user = typeof value === 'string' ? value.trim() : '';
    if (!USER.test(user)) return { refused: [401, 'Sign in to use Klipp.'] };
    const allow = this.options.allow ?? '*';
    if (allow !== '*' && !allow.some((name) => name.toLowerCase() === user.toLowerCase())) {
      return { refused: [403, "Klipp's chat isn't open to you here. Ask whoever runs this site."] };
    }
    return { user };
  }

  /** Counts a message; false when the user has already sent as many as an hour allows. */
  allowMessage(user: string, now = Date.now()): boolean {
    if (this.sent.size > 1000) {
      for (const [name, times] of this.sent) {
        if (!times.some((at) => now - at < HOUR)) this.sent.delete(name);
      }
    }
    const recent = (this.sent.get(user) ?? []).filter((at) => now - at < HOUR);
    if (recent.length >= (this.options.messagesPerHour ?? 30)) {
      this.sent.set(user, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(user, recent);
    return true;
  }
}
