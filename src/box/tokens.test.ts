import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
    const tokens = new Tokens(data, ENV);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tokens.json'));
    expect(tokens.check('klipp-token-0123456789')).toBe('klipp');
    warn.mockRestore();
  });
});
