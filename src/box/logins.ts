import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AGENTS, childEnv } from '../server/agents.js';
import type { AgentId } from '../shared/protocol.js';

export interface AgentStatus {
  id: AgentId;
  label: string;
  version?: string;
  signedIn: boolean;
  /** Why it can't run here apart from signing in, such as a sandbox the machine won't run. */
  problem?: string;
}

export type LoginState =
  | { state: 'starting' }
  | { state: 'waiting'; url: string; code?: string; needsCode: boolean }
  | { state: 'done' }
  | { state: 'failed'; message: string };

const COMMANDS = {
  claude: { login: ['auth', 'login'], logout: ['auth', 'logout'], status: ['auth', 'status'] },
  codex: { login: ['login', '--device-auth'], logout: ['logout'], status: ['login', 'status'] },
} satisfies Record<AgentId, Record<'login' | 'logout' | 'status', string[]>>;

// eslint-disable-next-line no-control-regex -- terminal colour codes in the CLIs' output
const ANSI = /\u001b\[[0-9;]*m/g;
const URL_PATTERN = /https:\/\/[^\s"'<>]+/;
const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/;
/** A code pasted from the sign-in page: printable, no spaces. */
const CODE = /^[!-~]{1,512}$/;

const lastLine = (text: string) => text.trim().split('\n').filter(Boolean).at(-1);

/** One CLI sign-in in progress: the link (and code) to show, and the code pasted back. */
export class Login {
  readonly id = randomUUID();
  state: LoginState = { state: 'starting' };
  private readonly listeners = new Set<(state: LoginState) => void>();
  private output = '';

  constructor(
    readonly agent: AgentId,
    private readonly child: ChildProcess,
    timeoutMs: number,
    onEnd: () => void,
  ) {
    const timer = setTimeout(() => {
      this.set({ state: 'failed', message: 'The sign-in timed out.' });
      child.kill('SIGTERM');
    }, timeoutMs);
    const read = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString('utf8')).replace(ANSI, '').slice(-8000);
      this.parse();
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => this.set({ state: 'failed', message: error.message }));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (this.state.state !== 'failed') {
        this.set(
          code === 0
            ? { state: 'done' }
            : {
                state: 'failed',
                message:
                  lastLine(this.output.split('>').at(-1) ?? '') ??
                  `The sign-in stopped (exit ${String(code)}).`,
              },
        );
      }
      onEnd();
    });
  }

  subscribe(listener: (state: LoginState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Passes the code from the sign-in page to the CLI; false when it isn't waiting for one. */
  sendCode(code: string): boolean {
    if (this.state.state !== 'waiting' || !this.state.needsCode || !CODE.test(code)) return false;
    this.child.stdin?.write(`${code}\n`);
    return true;
  }

  cancel() {
    if (this.state.state === 'done' || this.state.state === 'failed') return;
    this.set({ state: 'failed', message: 'Cancelled.' });
    this.child.kill('SIGTERM');
  }

  private parse() {
    if (this.state.state !== 'starting' && this.state.state !== 'waiting') return;
    const url = URL_PATTERN.exec(this.output)?.[0];
    const claude = this.agent === 'claude';
    const code = claude ? undefined : DEVICE_CODE.exec(this.output)?.[0];
    // Each link is useful only with what follows it: Codex's code, Claude's prompt for the
    // code from the page (claude 2.1 prints "Paste code here if prompted >").
    // ponytail: keyed on that wording; if a later CLI changes it, the link never shows.
    if (!url || (claude ? !/paste code/i.test(this.output) : !code)) return;
    const next: LoginState = {
      state: 'waiting',
      url,
      needsCode: claude,
      ...(code ? { code } : {}),
    };
    if (this.state.state !== 'waiting') this.set(next);
  }

  private set(state: LoginState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export interface LoginsOptions {
  commandOf(agent: AgentId): string[];
  /** Holds CLAUDE_CONFIG_DIR and CODEX_HOME: where the box keeps the logins. */
  env: NodeJS.ProcessEnv;
  /** Default: 15 minutes. */
  timeoutMs?: number | undefined;
}

/** Signing the agents in and out with their own CLIs, and asking them how they are. */
export class Logins {
  private readonly running = new Map<AgentId, Login>();
  private readonly all = new Map<string, Login>();
  private readonly status = new Map<AgentId, { at: number; value: Promise<boolean> }>();

  constructor(private readonly options: LoginsOptions) {}

  signedIn(agent: AgentId): Promise<boolean> {
    const cached = this.status.get(agent);
    if (cached && Date.now() - cached.at < 10_000) return cached.value;
    const value = this.exec(agent, COMMANDS[agent].status).then((r) => r.code === 0);
    this.status.set(agent, { at: Date.now(), value });
    return value;
  }

  async version(agent: AgentId): Promise<string | undefined> {
    const result = await this.exec(agent, ['--version']);
    return result.code === 0 ? result.stdout.trim().split('\n')[0] : undefined;
  }

  /** Starts the CLI's own sign-in, or joins the one already running. */
  start(agent: AgentId): Login {
    const running = this.running.get(agent);
    if (running) return running;
    const [binary, ...lead] = this.options.commandOf(agent);
    const child = spawn(binary!, [...lead, ...COMMANDS[agent].login], {
      env: childEnv(AGENTS[agent], this.options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const login = new Login(agent, child, this.options.timeoutMs ?? 15 * 60_000, () => {
      this.running.delete(agent);
      this.status.delete(agent);
    });
    this.running.set(agent, login);
    this.all.set(login.id, login);
    return login;
  }

  get(id: string): Login | undefined {
    return this.all.get(id);
  }

  async logout(agent: AgentId): Promise<void> {
    await this.exec(agent, COMMANDS[agent].logout);
    this.status.delete(agent);
  }

  close() {
    for (const login of this.running.values()) login.cancel();
  }

  private exec(agent: AgentId, args: string[]): Promise<{ code: number | null; stdout: string }> {
    const [binary, ...lead] = this.options.commandOf(agent);
    return new Promise((done) => {
      let stdout = '';
      const child = spawn(binary!, [...lead, ...args], {
        env: childEnv(AGENTS[agent], this.options.env),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
      });
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.on('error', () => done({ code: null, stdout }));
      child.on('close', (code) => done({ code, stdout }));
    });
  }
}
