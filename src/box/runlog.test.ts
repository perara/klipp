import { appendFileSync, chmodSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RunLog, type RunHead, type RunLine } from './runlog.js';

const dir = () => mkdtempSync(join(tmpdir(), 'klipp-runlog-'));
let n = 0;
const head = (app = 'klipp'): RunHead => ({
  id: `run-${++n}`,
  app,
  agent: 'claude',
  message: 'hi',
  started: new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString(),
});

describe('RunLog', () => {
  it('writes each run to its own private file, and reads it back', () => {
    const data = dir();
    const log = new RunLog(data);
    const h = head();
    const entry = log.start(h);
    entry.write({ type: 'event', at: 't', event: { type: 'text', delta: 'Hello' } });
    entry.end('done');
    expect(statSync(join(data, 'runs')).mode & 0o777).toBe(0o700);
    const [file] = readdirSync(join(data, 'runs'));
    expect(statSync(join(data, 'runs', file!)).mode & 0o777).toBe(0o600);
    expect(log.read(h.id)!.map((l) => l.type)).toEqual(['head', 'event', 'end']);
    expect(log.list()[0]).toEqual({
      id: h.id,
      app: 'klipp',
      agent: 'claude',
      started: h.started,
      live: false,
      outcome: 'done',
    });
  });

  it('lists the newest first and keeps only the newest it may', () => {
    const log = new RunLog(dir(), 3);
    const heads = [head(), head(), head(), head()];
    for (const h of heads) log.start(h).end('done');
    expect(log.list().map((r) => r.id)).toEqual(
      heads
        .slice(1)
        .reverse()
        .map((h) => h.id),
    );
    expect(log.read(heads[0]!.id)).toBeUndefined();
  });

  it('streams a live run to followers until it ends', () => {
    const log = new RunLog(dir());
    const h = head();
    const entry = log.start(h);
    const seen: RunLine['type'][] = [];
    log.follow(h.id, (line) => seen.push(line.type));
    expect(log.isLive(h.id)).toBe(true);
    entry.write({ type: 'tool_call', at: 't', id: 'c', name: 'point_at_element', input: {} });
    entry.end('stopped');
    expect(seen).toEqual(['tool_call', 'end']);
    expect(log.isLive(h.id)).toBe(false);
  });

  it('remembers which app owns a session, across a restart', () => {
    const data = dir();
    const entry = new RunLog(data).start(head('klipp'));
    entry.write({ type: 'event', at: 't', event: { type: 'session', id: 's-1' } });
    entry.end('done');
    expect(new RunLog(data).ownerOf('s-1')).toBe('klipp');
    expect(new RunLog(data).ownerOf('s-2')).toBeUndefined();
  });

  it('skips a broken line instead of losing the run', () => {
    const data = dir();
    const log = new RunLog(data);
    const h = head();
    log.start(h).end('done');
    const [file] = readdirSync(join(data, 'runs'));
    appendFileSync(join(data, 'runs', file!), '{broken\n');
    expect(new RunLog(data).read(h.id)!.map((l) => l.type)).toEqual(['head', 'end']);
  });

  it('keeps a session with the app that claimed it first, now and after a restart', () => {
    const data = dir();
    const log = new RunLog(data);
    const a = log.start(head('A'));
    a.write({ type: 'event', at: 't', event: { type: 'session', id: 's-1' } });
    a.end('done');
    const b = log.start({ ...head('B'), session: 's-1' });
    b.write({ type: 'event', at: 't', event: { type: 'session', id: 's-1' } });
    b.end('done');
    expect(log.ownerOf('s-1')).toBe('A');
    expect(new RunLog(data).ownerOf('s-1')).toBe('A');
  });

  it('gives an unowned session to the run whose head names it', () => {
    const data = dir();
    new RunLog(data).start({ ...head('A'), session: 's-2' }).end('done');
    const log = new RunLog(data);
    log.start({ ...head('B'), session: 's-3' });
    expect(log.ownerOf('s-3')).toBe('B');
    expect(log.ownerOf('s-2')).toBe('A');
  });

  it('survives a follower that throws: the run still ends, the others still hear every line', () => {
    const log = new RunLog(dir(), 1);
    const h = head();
    const entry = log.start(h);
    let calls = 0;
    log.follow(h.id, () => {
      calls++;
      throw new Error('boom');
    });
    const seen: RunLine['type'][] = [];
    let liveAtEnd: boolean | undefined;
    log.follow(h.id, (line) => {
      seen.push(line.type);
      if (line.type === 'end') liveAtEnd = log.isLive(h.id);
    });
    expect(() => {
      entry.write({ type: 'event', at: 't', event: { type: 'text', delta: 'a' } });
      entry.write({ type: 'event', at: 't', event: { type: 'text', delta: 'b' } });
      entry.end('done');
    }).not.toThrow();
    expect(calls).toBe(1);
    expect(seen).toEqual(['event', 'event', 'end']);
    expect(liveAtEnd).toBe(false);
    expect(log.isLive(h.id)).toBe(false);
    log.start(head()).end('done');
    expect(log.read(h.id)).toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)(
    'a log it can’t write to neither throws nor keeps followers from hearing the run',
    () => {
      const data = dir();
      const log = new RunLog(data);
      const h = head();
      const entry = log.start(h);
      const [name] = readdirSync(join(data, 'runs'));
      const file = join(data, 'runs', name!);
      chmodSync(file, 0o400);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const seen: RunLine['type'][] = [];
        log.follow(h.id, (line) => seen.push(line.type));
        expect(() => {
          entry.write({ type: 'event', at: 't', event: { type: 'text', delta: 'a' } });
          entry.write({ type: 'event', at: 't', event: { type: 'text', delta: 'b' } });
          entry.end('done');
        }).not.toThrow();
        expect(seen).toEqual(['event', 'event', 'end']);
        expect(log.list()[0]).toMatchObject({ id: h.id, live: false, outcome: 'done' });
        // One warning for the run, not one per line.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toContain(file);
      } finally {
        warn.mockRestore();
        chmodSync(file, 0o600);
      }
    },
  );

  it.each(['../evil', 'a.b', 'a b', ''])(
    'refuses the run id %j, which would be a file name',
    (id) => {
      const data = dir();
      const log = new RunLog(data);
      expect(() => log.start({ ...head(), id })).toThrow(/id/);
      expect(readdirSync(join(data, 'runs'))).toEqual([]);
      expect(log.list()).toEqual([]);
    },
  );

  it('follows only a run that is live', () => {
    const log = new RunLog(dir());
    const h = head();
    log.start(h).end('done');
    const seen: RunLine['type'][] = [];
    expect(() => log.follow(h.id, (line) => seen.push(line.type))()).not.toThrow();
    log.follow('run-later', (line) => seen.push(line.type));
    log.start({ ...head(), id: 'run-later' }).end('done');
    expect(seen).toEqual([]);
  });
});
