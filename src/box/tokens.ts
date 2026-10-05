import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TokenInfo {
  name: string;
  created?: string;
  lastUsed?: string;
  fromEnv: boolean;
}

interface Entry {
  name: string;
  sha256: string;
  created: string;
  lastUsed?: string;
}

const NAME = /^[\w.-]{1,40}$/;
const digestOf = (text: string) => createHash('sha256').update(text).digest();

function parseEnv(env: string | undefined) {
  return (env ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=');
      const name = pair.slice(0, Math.max(at, 0));
      const token = pair.slice(at + 1);
      if (at < 1 || !NAME.test(name)) {
        throw new Error('KLIPP_BOX_TOKENS is name=token pairs, comma-separated.');
      }
      if (token.length < 16)
        throw new Error('Each token in KLIPP_BOX_TOKENS needs 16 characters or more.');
      return { name, sha256: digestOf(token), lastUsed: undefined as string | undefined };
    });
}

const isEntry = (value: unknown): value is Entry => {
  const entry = value as Partial<Entry> | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.name === 'string' &&
    typeof entry.created === 'string' &&
    /^[0-9a-f]{64}$/.test(String(entry.sha256))
  );
};

/** Who may call the box: tokens from the environment, and tokens made in the web UI, kept as hashes. */
export class Tokens {
  private readonly file: string;
  private readonly fromEnv: ReturnType<typeof parseEnv>;
  private readonly entries: Entry[];

  /** @param env `name=token,…`, such as Klipp's own token, from `KLIPP_BOX_TOKENS`. */
  constructor(data: string, env?: string) {
    this.file = join(data, 'tokens.json');
    this.fromEnv = parseEnv(env);
    this.entries = this.load();
  }

  /** The name of the app the token belongs to, or undefined for a token the box doesn't know. */
  check(token: string): string | undefined {
    const digest = digestOf(token);
    const now = new Date().toISOString();
    const env = this.fromEnv.find((t) => timingSafeEqual(t.sha256, digest));
    if (env) {
      env.lastUsed = now;
      return env.name;
    }
    const entry = this.entries.find((t) => timingSafeEqual(Buffer.from(t.sha256, 'hex'), digest));
    if (!entry) return undefined;
    entry.lastUsed = now;
    this.save();
    return entry.name;
  }

  create(name: string): string {
    if (!NAME.test(name)) {
      throw new Error('A token name is 1 to 40 letters, digits, dots, dashes or underscores.');
    }
    if (this.list().some((t) => t.name === name))
      throw new Error(`There is already a token named ${name}.`);
    const token = `kbox_${randomBytes(32).toString('base64url')}`;
    this.entries.push({
      name,
      sha256: digestOf(token).toString('hex'),
      created: new Date().toISOString(),
    });
    this.save();
    return token;
  }

  revoke(name: string): boolean {
    const at = this.entries.findIndex((t) => t.name === name);
    if (at < 0) return false;
    this.entries.splice(at, 1);
    this.save();
    return true;
  }

  list(): TokenInfo[] {
    return [
      ...this.fromEnv.map((t) => ({
        name: t.name,
        fromEnv: true,
        ...(t.lastUsed ? { lastUsed: t.lastUsed } : {}),
      })),
      ...this.entries.map((t) => ({
        name: t.name,
        fromEnv: false,
        created: t.created,
        ...(t.lastUsed ? { lastUsed: t.lastUsed } : {}),
      })),
    ];
  }

  private load(): Entry[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    try {
      const value = JSON.parse(text) as unknown;
      if (!Array.isArray(value)) throw new Error('not a list');
      return value.filter(isEntry);
    } catch (error) {
      console.warn(
        `klipp box: ignoring ${this.file}, which isn't a token list (${error instanceof Error ? error.message : String(error)}).`,
      );
      return [];
    }
  }

  /** Written whole and renamed into place, readable only by this user. */
  private save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.entries, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
