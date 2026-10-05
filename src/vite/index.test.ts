import { mkdtempSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import klipp from './index.js';

describe('chat.box', () => {
  it('an empty token falls back to KLIPP_BOX_TOKEN', async () => {
    let auth: string | undefined;
    const box = createHttpServer((req, res) => {
      auth = req.headers.authorization;
      res.end('{"agents":[],"preferred":"claude"}');
    });
    await new Promise<void>((done) => box.listen(0, '127.0.0.1', done));
    const before = process.env.KLIPP_BOX_TOKEN;
    process.env.KLIPP_BOX_TOKEN = 'from-the-env-0123456789';
    const url = `http://127.0.0.1:${(box.address() as AddressInfo).port}`;
    const vite = await createServer({
      configFile: false,
      root: mkdtempSync(join(tmpdir(), 'klipp-vite-')),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [klipp({ enabled: true, chat: { box: { url, token: '' } } })],
    });
    try {
      await vite.listen();
      const app = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
      await fetch(`${app}/@klipp/agents`, { headers: { 'X-Klipp': '1' } });
      expect(auth).toBe('Bearer from-the-env-0123456789');
    } finally {
      await vite.close();
      box.close();
      if (before === undefined) delete process.env.KLIPP_BOX_TOKEN;
      else process.env.KLIPP_BOX_TOKEN = before;
    }
  });
});
