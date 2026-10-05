import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The built CLI, as `npm run check` has it by now (it builds before it tests). Without a build,
// there is nothing to run, and these wait for one.
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const klipp = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  });

describe.skipIf(!existsSync(cli))('the klipp command', () => {
  it('turns an unknown command away with its usage', () => {
    const run = klipp(['bogus']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage: klipp serve | klipp box');
  });

  it.each([['box'], ['serve']])('`%s --help` prints both commands and exits 0', (command) => {
    for (const flag of ['--help', '-h']) {
      const run = klipp([command, flag]);
      expect(run.status, `${command} ${flag}`).toBe(0);
      expect(run.stdout).toContain('klipp serve');
      expect(run.stdout).toContain('klipp box');
    }
  });

  it('still refuses extra words after a command', () => {
    expect(klipp(['box', 'now']).status).toBe(2);
  });

  it('says which setting is wrong, and exits 1', () => {
    const run = klipp(['box'], { KLIPP_BOX_PORT: 'x' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('klipp: KLIPP_BOX_PORT');
  });
});
