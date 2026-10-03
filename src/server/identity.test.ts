import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { Identity } from './identity.js';

const status = (who: { user: string } | { refused: [number, string] }) =>
  'refused' in who ? who.refused[0] : 200;

const from = (user?: string) =>
  ({ headers: user === undefined ? {} : { 'x-klipp-user': user } }) as unknown as IncomingMessage;

describe('Identity', () => {
  it('takes the user from the header the proxy sets, and refuses a request without one', () => {
    const identity = new Identity({ header: 'X-Klipp-User' });
    expect(identity.userOf(from('kari@example.no'))).toEqual({ user: 'kari@example.no' });
    expect(identity.userOf(from())).toEqual({ refused: [401, 'Sign in to use Klipp.'] });
    expect(status(identity.userOf(from('')))).toBe(401);
    for (const odd of ['a b', 'a,b@x', '<x>', 'x`y', 'x"y']) {
      expect(status(identity.userOf(from(odd)))).toBe(401);
    }
  });

  it('lets in only the users it lists, ignoring case, unless it lists everyone', () => {
    const listed = new Identity({ header: 'x-klipp-user', allow: ['Kari@example.no'] });
    expect(listed.userOf(from('kari@EXAMPLE.no'))).toEqual({ user: 'kari@EXAMPLE.no' });
    expect(status(listed.userOf(from('ola@example.no')))).toBe(403);
    expect(new Identity({ header: 'x-klipp-user', allow: '*' }).userOf(from('ola@x.no'))).toEqual({
      user: 'ola@x.no',
    });
  });

  it('counts messages per user over the last hour', () => {
    const identity = new Identity({ header: 'x-klipp-user', messagesPerHour: 2 });
    const t = 1_000_000;
    expect(identity.allowMessage('kari', t)).toBe(true);
    expect(identity.allowMessage('kari', t + 1)).toBe(true);
    expect(identity.allowMessage('kari', t + 2)).toBe(false);
    expect(identity.allowMessage('ola', t + 2)).toBe(true);
    expect(identity.allowMessage('kari', t + 60 * 60 * 1000 + 1)).toBe(true);
  });
});
