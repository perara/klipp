import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '../server/agents.js';
import type { AgentId } from '../shared/protocol.js';

export interface RunHead {
  id: string;
  /** The token's name: the app that asked. */
  app: string;
  agent: AgentId;
  model?: string;
  session?: string;
  message: string;
  started: string;
}
export type Outcome = 'done' | 'error' | 'stopped';
export type RunLine =
  | ({ type: 'head' } & RunHead)
  | { type: 'event'; at: string; event: AgentEvent }
  | { type: 'tool_call'; at: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; at: string; id: string; content: string; isError: boolean }
  | { type: 'end'; at: string; outcome: Outcome };
export interface RunSummary {
  id: string;
  app: string;
  agent: AgentId;
  started: string;
  live: boolean;
  outcome?: Outcome;
}
export interface RunEntry {
  write(line: Exclude<RunLine, { type: 'head' | 'end' }>): void;
  end(outcome: Outcome): void;
}

const FILE = /^[\w-]+\.jsonl$/;
const ID = /^[\w-]+$/;

function readLines(file: string): RunLine[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    if (!line) return [];
    try {
      const value = JSON.parse(line) as { type?: unknown };
      return typeof value === 'object' && value !== null && typeof value.type === 'string'
        ? [value as RunLine]
        : [];
    } catch {
      return [];
    }
  });
}

/** Every run the box made, one JSON-lines file each, the newest `keep` of them kept. */
export class RunLog {
  private readonly dir: string;
  private readonly runs = new Map<string, RunSummary & { file: string }>();
  private readonly owners = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(line: RunLine) => void>>();

  constructor(
    data: string,
    private readonly keep = 200,
  ) {
    this.dir = join(data, 'runs');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    for (const name of readdirSync(this.dir)
      .filter((n) => FILE.test(n))
      .sort())
      this.index(name);
  }

  start(head: RunHead): RunEntry {
    if (!ID.test(head.id)) throw new Error('A run id is letters, digits, _ and - only.');
    const file = `${head.started.replace(/[:.]/g, '-')}-${head.id}.jsonl`;
    const path = join(this.dir, file);
    closeSync(openSync(path, 'a', 0o600));
    const summary: RunSummary & { file: string } = {
      id: head.id,
      app: head.app,
      agent: head.agent,
      started: head.started,
      live: true,
      file,
    };
    this.runs.set(head.id, summary);
    if (head.session) this.claim(head.session, head.app);
    const append = (line: RunLine) => {
      appendFileSync(path, `${JSON.stringify(line)}\n`);
      for (const listener of this.listeners.get(head.id) ?? []) {
        try {
          listener(line);
        } catch {
          this.listeners.get(head.id)?.delete(listener);
        }
      }
    };
    append({ type: 'head', ...head });
    this.prune();
    return {
      write: (line) => {
        this.own(head.app, line);
        append(line);
      },
      end: (outcome) => {
        summary.live = false;
        summary.outcome = outcome;
        try {
          append({ type: 'end', at: new Date().toISOString(), outcome });
        } finally {
          this.listeners.delete(head.id);
        }
      },
    };
  }

  list(): RunSummary[] {
    return [...this.runs.values()]
      .sort((a, b) => b.started.localeCompare(a.started) || b.file.localeCompare(a.file))
      .map((r) => ({
        id: r.id,
        app: r.app,
        agent: r.agent,
        started: r.started,
        live: r.live,
        ...(r.outcome ? { outcome: r.outcome } : {}),
      }));
  }

  read(id: string): RunLine[] | undefined {
    const run = this.runs.get(id);
    return run ? readLines(join(this.dir, run.file)) : undefined;
  }

  isLive(id: string): boolean {
    return this.runs.get(id)?.live ?? false;
  }

  /**
   * Hears every line written from now until the run ends; a run that isn't live gives none.
   * Call it right after `read()`, in the same tick, so no line is missed or repeated.
   */
  follow(id: string, listener: (line: RunLine) => void): () => void {
    if (!this.isLive(id)) return () => {};
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => set.delete(listener);
  }

  /**
   * The app whose run first claimed this agent session. `undefined` means unknown: start a
   * new session, never resume.
   */
  ownerOf(session: string): string | undefined {
    return this.owners.get(session);
  }

  private own(app: string, line: RunLine) {
    if (line.type === 'event' && line.event.type === 'session') this.claim(line.event.id, app);
  }

  /** The first app to claim a session keeps it. */
  private claim(session: string, app: string) {
    if (!this.owners.has(session)) this.owners.set(session, app);
  }

  private index(file: string) {
    const lines = readLines(join(this.dir, file));
    const head = lines[0];
    if (head?.type !== 'head') return;
    const end = lines.findLast((line) => line.type === 'end');
    this.runs.set(head.id, {
      id: head.id,
      app: head.app,
      agent: head.agent,
      started: head.started,
      live: false,
      file,
      ...(end?.type === 'end' ? { outcome: end.outcome } : {}),
    });
    if (head.session) this.claim(head.session, head.app);
    for (const line of lines) this.own(head.app, line);
  }

  private prune() {
    const finished = [...this.runs.values()]
      .filter((r) => !r.live)
      .sort((a, b) => a.started.localeCompare(b.started) || a.file.localeCompare(b.file));
    for (const run of finished.slice(0, Math.max(0, this.runs.size - this.keep))) {
      rmSync(join(this.dir, run.file), { force: true });
      this.runs.delete(run.id);
    }
  }
}
