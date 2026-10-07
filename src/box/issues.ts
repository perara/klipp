import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileGitHubIssue } from '../server/github.js';
import { MAX_SCREENSHOTS, isScreenshot, type Screenshot } from '../shared/screenshot.js';
import type { Logins } from './logins.js';
import type { BoxAudit } from './server.js';

export interface BoxIssue {
  /** A stable proposal id; every app gets its own namespace. */
  id: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
  attachments: Screenshot[];
}

export function parseBoxIssue(body: Record<string, unknown>): BoxIssue | undefined {
  const { id, repo, title, labels = [], attachments = [] } = body;
  if (
    typeof id !== 'string' ||
    !/^[\w-]{1,128}$/.test(id) ||
    typeof repo !== 'string' ||
    !/^https:\/\/github\.com\/[A-Za-z0-9][\w-]*\/[A-Za-z0-9_][\w.-]*\/?$/.test(repo) ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 256 ||
    typeof body.body !== 'string' ||
    body.body.length > 60_000 ||
    !Array.isArray(labels) ||
    labels.length > 20 ||
    labels.some((l) => typeof l !== 'string' || l.length > 50) ||
    !Array.isArray(attachments) ||
    attachments.length > MAX_SCREENSHOTS ||
    !attachments.every(isScreenshot)
  )
    return;
  return {
    id,
    repo,
    title,
    body: body.body,
    labels: labels as string[],
    attachments,
  };
}

/** Durable, consumed-before-network proposal receipts. Ambiguous failures never retry a POST. */
export class BoxIssues {
  private readonly file: string;
  private readonly receipts: Record<string, { fingerprint: string; url?: string }>;
  constructor(
    data: string,
    private readonly logins: Logins,
    private readonly audit?: (entry: BoxAudit) => void,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.file = join(data, 'issues.json');
    this.receipts = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as typeof this.receipts)
      : {};
  }

  async fileIssue(app: string, issue: BoxIssue): Promise<{ status: number; body: object }> {
    const key = createHash('sha256')
      .update(JSON.stringify([app, issue.id]))
      .digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify(issue)).digest('hex');
    const prior = this.receipts[key];
    if (prior) return this.prior(prior, fingerprint);
    const token = await this.logins.githubToken();
    if (!token)
      return {
        status: 409,
        body: { code: 'github_signed_out', error: 'Sign in to GitHub in Smia.' },
      };
    // The token lookup yielded: check again before consuming the request synchronously.
    const raced = this.receipts[key];
    if (raced) return this.prior(raced, fingerprint);
    this.receipts[key] = { fingerprint };
    this.save();
    try {
      const url = await fileGitHubIssue(
        issue.repo,
        issue,
        token,
        issue.labels,
        issue.attachments,
        this.fetchImpl,
      );
      this.receipts[key] = { fingerprint, url };
      this.save();
      this.audit?.({ user: app, action: 'issue.filed', target: url });
      return { status: 200, body: { url } };
    } catch {
      return {
        status: 502,
        body: {
          error:
            'GitHub filing failed or its result is uncertain. Check the repository before proposing another ticket.',
        },
      };
    }
  }

  private prior(receipt: { fingerprint: string; url?: string }, fingerprint: string) {
    if (receipt.fingerprint === fingerprint && receipt.url)
      return { status: 200, body: { url: receipt.url } };
    return {
      status: 409,
      body: {
        error:
          'This proposal was already consumed. Check the repository before proposing another ticket.',
      },
    };
  }

  private save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.receipts), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
