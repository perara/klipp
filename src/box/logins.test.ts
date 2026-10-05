import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logins, type LoginState } from './logins.js';

const fakeAgent = [
  process.execPath,
  fileURLToPath(new URL('../../test/fake-agent.mjs', import.meta.url)),
];

/** `extra` is more environment for the fake agent, such as CODEX_FAKE_DEVICE_MS. */
function logins(timeoutMs?: number, extra: NodeJS.ProcessEnv = {}) {
  const data = mkdtempSync(join(tmpdir(), 'klipp-logins-'));
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(data, 'claude'),
    CODEX_HOME: join(data, 'codex'),
    ...extra,
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

  it('starts a new sign-in once the last one has ended', async () => {
    const box = (open = logins());
    const first = box.start('claude');
    await until(first, 'waiting');
    first.cancel();
    const second = box.start('claude');
    expect(second).not.toBe(first);
    expect((await until(second, 'waiting')).state).toBe('waiting');
    // The first one's child ending later must not take the second one's place.
    expect(box.start('claude')).toBe(second);
  });

  it('takes one code, and only a code', async () => {
    const login = (open = logins()).start('claude');
    expect(login.sendCode('good-code')).toBe(false); // the link isn't out yet
    await until(login, 'waiting');
    for (const bad of ['', 'two words', 'line\nbreak', 'x'.repeat(513)])
      expect(login.sendCode(bad)).toBe(false);
    expect(login.sendCode('good-code')).toBe(true);
    // The CLI has its code: the page stops asking, and a second code is refused.
    expect(login.state).toEqual({
      state: 'waiting',
      url: 'https://claude.example/oauth/authorize?code=true',
      needsCode: false,
    });
    expect(login.sendCode('good-code')).toBe(false);
    await until(login, 'done');
    expect(login.sendCode('good-code')).toBe(false);
  });

  it('takes no code for a Codex sign-in', async () => {
    const login = (open = logins()).start('codex');
    await until(login, 'waiting');
    expect(login.sendCode('ABCD-EFGH')).toBe(false);
  });

  it('says what Codex said when its sign-in fails', async () => {
    const message = 'The code expired > start again';
    const login = (open = logins(undefined, { CODEX_FAKE_DEVICE_ERROR: message })).start('codex');
    expect(await until(login, 'failed')).toEqual({ state: 'failed', message });
  });

  it('still finishes when a listener throws', async () => {
    const box = (open = logins());
    expect(await box.signedIn('codex')).toBe(false);
    const login = box.start('codex');
    login.subscribe((state) => {
      if (state.state === 'done') throw new Error('a listener that fails');
    });
    await until(login, 'done');
    // The sign-in's end must still have dropped the remembered answer.
    expect(await box.signedIn('codex')).toBe(true);
  });

  it('asks Claude to sign in with the subscription', async () => {
    const login = (open = logins()).start('claude');
    // The fake refuses `claude auth login` without --claudeai.
    expect((await until(login, 'waiting')).state).toBe('waiting');
  });

  it('does not count an API key as a sign-in', async () => {
    const box = (open = logins(undefined, { CLAUDE_FAKE_AUTH: 'api_key' }));
    expect(await box.signedIn('claude')).toBe(false);
  });

  it('stops a sign-in that is running when it closes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'klipp-logins-codex-'));
    const box = (open = logins(undefined, { CODEX_HOME: home, CODEX_FAKE_DEVICE_MS: '600000' }));
    const login = box.start('codex');
    await until(login, 'waiting');
    const pid = Number(readFileSync(join(home, 'login.pid'), 'utf8'));
    box.close();
    expect(login.state).toEqual({ state: 'failed', message: 'Cancelled.' });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });
});
