import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
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

  it.each([['box'], ['smia'], ['serve']])(
    '`%s --help` prints both commands and exits 0',
    (command) => {
      for (const flag of ['--help', '-h']) {
        const run = klipp([command, flag]);
        expect(run.status, `${command} ${flag}`).toBe(0);
        expect(run.stdout).toContain('klipp serve');
        expect(run.stdout).toContain('klipp box');
      }
    },
  );

  it('still refuses extra words after a command', () => {
    expect(klipp(['box', 'now']).status).toBe(2);
  });

  it.each(['box', 'smia'])('names the page at [::1] for %s listening there', async (command) => {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, '::1', done));
    const { port } = probe.address() as AddressInfo;
    await new Promise((done) => probe.close(done));
    const data = mkdtempSync(join(tmpdir(), 'klipp-cli-box-'));
    const box = spawn(process.execPath, [cli, command], {
      env: {
        ...process.env,
        KLIPP_ROOT: data,
        KLIPP_BOX_DATA: data,
        KLIPP_BOX_HOST: '::1',
        KLIPP_BOX_PORT: String(port),
      },
    });
    try {
      const [line] = (await once(createInterface({ input: box.stdout }), 'line')) as [string];
      expect(line).toContain(`Its page is at http://[::1]:${port}/, and answers only at`);
    } finally {
      box.kill('SIGTERM');
      await once(box, 'exit');
    }
  });

  it('says which setting is wrong, and exits 1', () => {
    const run = klipp(['box'], { KLIPP_BOX_PORT: 'x' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('klipp: KLIPP_BOX_PORT');
  });
});
