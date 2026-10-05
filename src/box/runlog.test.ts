import { appendFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
