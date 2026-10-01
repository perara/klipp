import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SourceAccess, SourceError } from './source.js';

let root: string;
let source: SourceAccess;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'klipp-source-'));
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('src/App.tsx', Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));
  write('src/Button.tsx', 'export const Button = () => <button disabled />;\n');
  write('.env', 'ANTHROPIC_API_KEY=secret\n');
  write('.env.example', 'ANTHROPIC_API_KEY=\n');
  write('config/server.pem', 'key\n');
  write('dist/bundle.js', 'built\n');
  write('.gitignore', 'dist/\n.env\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', 'src', '.gitignore', 'config', '.env.example'], { cwd: root });
  source = new SourceAccess(root);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('SourceAccess.read', () => {
  it('reads numbered lines, 400 by default', () => {
    const text = source.read('src/App.tsx');
    expect(text.split('\n')[0]).toBe('src/App.tsx, lines 1–400 of 1000');
    expect(text).toContain('400\tline 400');
    expect(text).not.toContain('401\tline 401');
  });

  it('reads a range, and never more than 800 lines', () => {
    expect(source.read('src/App.tsx', 10, 12).split('\n')).toEqual([
      'src/App.tsx, lines 10–12 of 1000',
      '10\tline 10',
      '11\tline 11',
      '12\tline 12',
    ]);
    expect(source.read('./src/App.tsx', 1, 5000).split('\n')[0]).toBe(
      'src/App.tsx, lines 1–800 of 1000',
    );
  });

  it.each([
    ['../outside.txt', /outside the repository/],
    ['/etc/passwd', /not a file in the repository|outside/],
    ['src/../../x', /outside the repository/],
    ['.env', /secrets/],
    ['.env.example', /secrets/],
    ['config/server.pem', /secrets/],
    ['dist/bundle.js', /not a file in the repository/],
    ['src/Missing.tsx', /not a file in the repository/],
  ])('refuses %s', (path, message) => {
    expect(() => source.read(path)).toThrow(SourceError);
    expect(() => source.read(path)).toThrow(message);
  });
});

describe('SourceAccess.search', () => {
  it('finds matches as path:line:text', async () => {
    expect(await source.search('disabled')).toBe(
      'src/Button.tsx:1:export const Button = () => <button disabled />;',
    );
  });

  it('says so when nothing matches, and stays out of secret files', async () => {
    expect(await source.search('no-such-thing-here')).toBe('No matches.');
    expect(await source.search('ANTHROPIC_API_KEY')).toBe('No matches.');
  });

  it('refuses a directory outside the repository', () => {
    expect(() => source.search('x', '../elsewhere')).toThrow(SourceError);
  });
});
