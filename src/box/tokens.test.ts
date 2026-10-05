import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Tokens } from './tokens.js';

const dir = () => mkdtempSync(join(tmpdir(), 'klipp-tokens-'));
const ENV = 'klipp=klipp-token-0123456789';

describe('Tokens', () => {
  it('makes a token, keeps only its hash, and knows it again after a restart', () => {
    const data = dir();
    const token = new Tokens(data).create('square-dev');
    const file = readFileSync(join(data, 'tokens.json'), 'utf8');
    expect(file).not.toContain(token);
    expect(statSync(join(data, 'tokens.json')).mode & 0o777).toBe(0o600);
    expect(new Tokens(data).check(token)).toBe('square-dev');
    expect(new Tokens(data).check('kbox_wrong')).toBeUndefined();
  });

  it('notes when a token was last used', () => {
    const tokens = new Tokens(dir());
    const token = tokens.create('a');
    expect(tokens.list()[0]!.lastUsed).toBeUndefined();
    tokens.check(token);
    expect(tokens.list()[0]!.lastUsed).toMatch(/^\d{4}-/);
  });

  it('revokes tokens made in the UI, never environment tokens', () => {
    const tokens = new Tokens(dir(), ENV);
    const token = tokens.create('a');
    expect(tokens.revoke('a')).toBe(true);
    expect(tokens.check(token)).toBeUndefined();
    expect(tokens.revoke('klipp')).toBe(false);
    expect(tokens.check('klipp-token-0123456789')).toBe('klipp');
    expect(tokens.list()).toEqual([{ name: 'klipp', fromEnv: true, lastUsed: expect.any(String) }]);
  });

  it('refuses bad and duplicate names, and malformed environment tokens', () => {
    const tokens = new Tokens(dir(), ENV);
    expect(() => tokens.create('has space')).toThrow(/1 to 40/);
    expect(() => tokens.create('klipp')).toThrow(/already/);
    expect(() => new Tokens(dir(), 'klipp')).toThrow(/name=token/);
    expect(() => new Tokens(dir(), 'klipp=short')).toThrow(/16 characters/);
  });

  it('a corrupt tokens.json is ignored, with a warning', () => {
    const data = dir();
    writeFileSync(join(data, 'tokens.json'), '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const tokens = new Tokens(data, ENV);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('tokens.json'));
      expect(tokens.check('klipp-token-0123456789')).toBe('klipp');
    } finally {
      warn.mockRestore();
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    "a valid UI token still authenticates when tokens.json can't be written",
    () => {
      const data = dir();
      const tokens = new Tokens(data);
      const token = tokens.create('a');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (tokens as any).lastPersisted.clear();
      // Make directory read-only so save fails.
      try {
        chmodSync(data, 0o500);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
          expect(tokens.check(token)).toBe('a');
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('tokens.json'));
        } finally {
          warn.mockRestore();
        }
      } finally {
        chmodSync(data, 0o700);
      }
    },
  );

  it('lastUsed survives a restart', () => {
    const data = dir();
    const token = new Tokens(data).create('a');
    expect(new Tokens(data).list()[0]!.lastUsed).toBeUndefined();
    new Tokens(data).check(token);
    expect(new Tokens(data).list()[0]!.lastUsed).toMatch(/^\d{4}-/);
  });

  it('entries with malformed sha256 (not a string) are dropped', () => {
    const data = dir();
    const validSha = createHash('sha256').update('test-token-1234567890').digest('hex');
    writeFileSync(
      join(data, 'tokens.json'),
      JSON.stringify([
        { name: 'valid', sha256: validSha, created: '2026-01-01T00:00:00Z' },
        { name: 'invalid', sha256: ['a'.repeat(64)], created: '2026-01-01T00:00:00Z' },
      ]),
    );
    const tokens = new Tokens(data);
    expect(tokens.list()).toHaveLength(1);
    expect(tokens.list()[0]!.name).toBe('valid');
    expect(tokens.check('unknown')).toBeUndefined();
  });

  it('lastUsed persists at most once per minute per token', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const data = dir();
      const tokens = new Tokens(data);
      const token = tokens.create('a');

      // First check: persists immediately (just created, so lastPersisted is set).
      // Clear lastPersisted to force the first check to persist.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (tokens as any).lastPersisted.clear();
      tokens.check(token);
      let file = readFileSync(join(data, 'tokens.json'), 'utf8');
      let parsed = JSON.parse(file) as unknown;
      const firstLastUsed = (parsed as Record<string, unknown>[])[0]!.lastUsed;
      expect(firstLastUsed).toMatch(/^\d{4}-/);

      // Check within 60s: does not persist, so file's lastUsed stays the same.
      vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
      tokens.check(token);
      file = readFileSync(join(data, 'tokens.json'), 'utf8');
      parsed = JSON.parse(file) as unknown;
      expect((parsed as Record<string, unknown>[])[0]!.lastUsed).toBe(firstLastUsed);

      // Check after 61s: persists, so file's lastUsed is updated.
      vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
      tokens.check(token);
      file = readFileSync(join(data, 'tokens.json'), 'utf8');
      parsed = JSON.parse(file) as unknown;
      expect((parsed as Record<string, unknown>[])[0]!.lastUsed).not.toBe(firstLastUsed);
      expect((parsed as Record<string, unknown>[])[0]!.lastUsed).toMatch(/^\d{4}-/);
    } finally {
      vi.useRealTimers();
    }
  });
});
