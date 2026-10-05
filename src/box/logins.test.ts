import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Logins, type LoginState } from './logins.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];

function logins(timeoutMs?: number) {
  const data = mkdtempSync(join(tmpdir(), 'klipp-logins-'));
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(data, 'claude'),
    CODEX_HOME: join(data, 'codex'),
  };
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  mkdirSync(env.CODEX_HOME, { recursive: true });
  return new Logins({ commandOf: () => fakeAgent, env, ...(timeoutMs ? { timeoutMs } : {}) });
}
const until = (
  login: { subscribe(fn: (s: LoginState) => void): () => void },
  want: LoginState['state'],
) =>
  new Promise<LoginState>((done) => {
    const stop = login.subscribe((state) => {
      if (state.state === want) {
        queueMicrotask(stop);
        done(state);
      }
    });
  });

let open: Logins | undefined;
afterEach(() => open?.close());

describe('Logins', () => {
  it('signs Claude in with the code pasted back, and knows its version', async () => {
    const box = (open = logins());
    expect(await box.signedIn('claude')).toBe(false);
    expect(await box.version('claude')).toBe('9.9.9 (fake)');
    const login = box.start('claude');
    const waiting = await until(login, 'waiting');
    expect(waiting).toEqual({
      state: 'waiting',
      url: 'https://claude.example/oauth/authorize?code=true',
      needsCode: true,
    });
    expect(login.sendCode('good-code')).toBe(true);
    await until(login, 'done');
    expect(await box.signedIn('claude')).toBe(true);
  });

  it('says why a sign-in failed', async () => {
    const login = (open = logins()).start('claude');
    await until(login, 'waiting');
    login.sendCode('bad-code');
    expect(await until(login, 'failed')).toEqual({ state: 'failed', message: 'Invalid code' });
  });

  it('signs Codex in with a device code, without a terminal', async () => {
    const box = (open = logins());
    const login = box.start('codex');
    expect(await until(login, 'waiting')).toEqual({
      state: 'waiting',
      url: 'https://auth.example/codex/device',
      code: 'ABCD-EFGH',
      needsCode: false,
    });
    await until(login, 'done');
    expect(await box.signedIn('codex')).toBe(true);
    await box.logout('codex');
    expect(await box.signedIn('codex')).toBe(false);
  });

  it('a second sign-in while one runs joins it', () => {
    const box = (open = logins());
    expect(box.start('claude')).toBe(box.start('claude'));
  });

  it('cancels, and gives up after its time', async () => {
    const cancelled = (open = logins()).start('claude');
    await until(cancelled, 'waiting');
    cancelled.cancel();
    expect(cancelled.state).toEqual({ state: 'failed', message: 'Cancelled.' });
    open.close();
    const slow = (open = logins(200)).start('claude');
    expect(await until(slow, 'failed')).toEqual({
      state: 'failed',
      message: 'The sign-in timed out.',
    });
  });
});
