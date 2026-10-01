import { describe, expect, it } from 'vitest';
import { formatId, instanceHash, parseId, sourceId } from './id.js';

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

  it('rejects anything else', () => {
    for (const text of ['', '3f9a2c1', '3F9A2C1D', '3f9a2c1d.x7k', '3f9a2c1d:0', '3f9a2c1d/a']) {
      expect(parseId(text)).toBeUndefined();
    }
  });
});
