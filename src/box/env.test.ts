import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxOptionsFromEnv } from './env.js';

describe('boxOptionsFromEnv', () => {
  it('has defaults for a box on this machine', () => {
    expect(boxOptionsFromEnv({}, '/repo')).toEqual({
      root: '/repo',
      host: '127.0.0.1',
      port: 8790,
      data: join(homedir(), '.klipp-box'),
      maxRuns: 2,
    });
  });

  it('reads every setting', () => {
    expect(
      boxOptionsFromEnv(
        {
          KLIPP_ROOT: '/srv/square',
          KLIPP_BOX_HOST: '0.0.0.0',
          KLIPP_BOX_PORT: '9000',
          KLIPP_BOX_DATA: '/data',
          KLIPP_BOX_TOKENS: 'klipp=klipp-token-0123456789',
          KLIPP_MAX_RUNS: '3',
          KLIPP_MODEL: 'opus',
        },
        '/x',
      ),
    ).toEqual({
      root: '/srv/square',
      host: '0.0.0.0',
      port: 9000,
      data: '/data',
      maxRuns: 3,
      tokens: 'klipp=klipp-token-0123456789',
      model: 'opus',
    });
    expect(() => boxOptionsFromEnv({ KLIPP_BOX_PORT: 'x' }, '/x')).toThrow(/KLIPP_BOX_PORT/);
  });
});
