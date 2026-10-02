import { describe, expect, it } from 'vitest';
import { formatId, instanceHash, parseId, sourceId, withTarget } from './id.js';

describe('ids', () => {
  it('derives the same sid from the same place in the source', () => {
    const sid = sourceId('src/App.tsx', 12, 7);
    expect(sid).toMatch(/^[0-9a-z]{8}$/);
    expect(sourceId('src/App.tsx', 12, 7)).toBe(sid);
    expect(sourceId('src/App.tsx', 12, 8)).not.toBe(sid);
    expect(sourceId('src/Other.tsx', 12, 7)).not.toBe(sid);
  });

  it('tells instances apart by call sites and keys', () => {
    const a = instanceHash(['aaaaaaaa'], ['row-1']);
    expect(a).toMatch(/^[0-9a-z]{4}$/);
    expect(instanceHash(['aaaaaaaa'], ['row-1'])).toBe(a);
    expect(instanceHash(['aaaaaaaa'], ['row-2'])).not.toBe(a);
    expect(instanceHash(['bbbbbbbb'], ['row-1'])).not.toBe(a);
  });

  it('round-trips every part of an id', () => {
    const id = { sid: '3f9a2c1d', instance: 'x7k2', ordinal: 2, path: [1, 0] };
    expect(formatId(id)).toBe('3f9a2c1d.x7k2:2/1/0');
    expect(parseId('3f9a2c1d.x7k2:2/1/0')).toEqual(id);
  });

  it('leaves out the ordinal for the first instance and parses a bare sid', () => {
    expect(formatId({ sid: '3f9a2c1d', instance: 'x7k2', ordinal: 1, path: [] })).toBe(
      '3f9a2c1d.x7k2',
    );
    expect(parseId(' 3f9a2c1d ')).toEqual({ sid: '3f9a2c1d', ordinal: 1, path: [] });
  });

  it('steps into shadow roots and names what a canvas drew', () => {
    const id = {
      sid: '3f9a2c1d',
      instance: 'x7k2',
      ordinal: 1,
      path: [2, 's' as const, 0],
      target: "roads:42 (north) it's",
    };
    const text = formatId(id);
    expect(text).toBe('3f9a2c1d.x7k2/2/s/0@roads%3A42%20%28north%29%20it%27s');
    expect(parseId(text)).toEqual(id);
    expect(withTarget('3f9a2c1d.x7k2', 'a/b')).toBe('3f9a2c1d.x7k2@a%2Fb');
    expect(parseId('3f9a2c1d@roads:42/a')?.target).toBe('roads:42/a');
    expect(parseId('3f9a2c1d@a%2Fb')).toEqual({
      sid: '3f9a2c1d',
      ordinal: 1,
      path: [],
      target: 'a/b',
    });
  });

  it('rejects anything else', () => {
    for (const text of [
      '',
      '3f9a2c1',
      '3F9A2C1D',
      '3f9a2c1d.x7k',
      '3f9a2c1d:0',
      '3f9a2c1d/a',
      '3f9a2c1d/S',
      '3f9a2c1d@',
      '3f9a2c1d@a b',
      '3f9a2c1d@%E0%A4%A',
      '3f9a2c1d@%ZZ',
      '3f9a2c1d@`x`',
    ]) {
      expect(parseId(text)).toBeUndefined();
    }
  });
});
