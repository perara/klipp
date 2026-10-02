import { describe, expect, it } from 'vitest';
import { normalizeRemote, parsePorcelain } from './git.js';

describe('normalizeRemote', () => {
  it.each([
    ['git@github.com:perara/klipp.git', 'https://github.com/perara/klipp'],
    ['git@github.com:perara/klipp', 'https://github.com/perara/klipp'],
    ['ssh://git@github.com/perara/klipp.git', 'https://github.com/perara/klipp'],
    ['https://github.com/perara/klipp.git', 'https://github.com/perara/klipp'],
    [
      'https://x-access-token:secret@github.com/perara/klipp.git',
      'https://github.com/perara/klipp',
    ],
    ['https://github.com/perara/klipp/', 'https://github.com/perara/klipp'],
    ['https://git.example.com:8443/team/app.git', 'https://git.example.com:8443/team/app'],
    ['ssh://git@git.example.com:2222/team/app.git', 'https://git.example.com/team/app'],
  ])('%s → %s', (remote, expected) => {
    expect(normalizeRemote(remote)).toBe(expected);
  });

  it('gives up on local paths', () => {
    expect(normalizeRemote('/srv/git/klipp.git')).toBeUndefined();
  });
});

describe('parsePorcelain', () => {
  it('lists changed, added, untracked and renamed paths', () => {
    const output = [
      ' M src/a.tsx',
      'A  src/b.tsx',
      '?? notes.md',
      'R  src/new.tsx',
      'src/old.tsx',
      '',
    ];
    expect(parsePorcelain(output.join('\0'))).toEqual([
      'src/a.tsx',
      'src/b.tsx',
      'notes.md',
      'src/new.tsx',
    ]);
  });
});
