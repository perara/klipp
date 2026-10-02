// Records the README's demo GIF: the example app, a bug report from first words to filed ticket.
// Run with `npm run demo:record`; needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = join(root, '.github/assets/klipp-demo.gif');
const videos = mkdtempSync(join(tmpdir(), 'klipp-demo-'));
process.env.KLIPP_DEMO = '1';

const server = await createServer({
  root: join(root, 'examples/react-app'),
  server: { port: 5293, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch();
const size = { width: 1100, height: 700 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: videos, size } });
// A visible pointer, since recordings don't show one.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(9,105,218,.35);border:2px solid #0969da;pointer-events:none;transition:transform .08s;left:-40px;top:-40px';
    document.documentElement.append(dot);
    addEventListener(
      'pointermove',
      (e) => ((dot.style.left = `${e.clientX}px`), (dot.style.top = `${e.clientY}px`)),
      true,
    );
    addEventListener('pointerdown', () => (dot.style.transform = 'scale(.7)'), true);
    addEventListener('pointerup', () => (dot.style.transform = ''), true);
  });
});
const page = await context.newPage();
const started = Date.now();
try {
  await page.goto('http://127.0.0.1:5293/');
  const figure = page.getByRole('button', { name: /Klipp: ask/ });
  await figure.waitFor();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(900);
  const box = await figure.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1600);
  const input = page.getByRole('textbox', { name: 'Message Klipp' });
  await input.pressSequentially("The Save button doesn't work.", { delay: 55 });
  await page.waitForTimeout(300);
  await input.press('Enter');
  await page.locator('.hint').waitFor();
  await page.waitForTimeout(700);
  const save = await page.getByRole('button', { name: 'Save' }).boundingBox();
  await page.mouse.move(save.x + save.width / 2, save.y + save.height / 2, { steps: 30 });
  await page.waitForTimeout(700);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('.chat .msg.klipp', { hasText: 'What should happen' }).waitFor();
  await page.waitForTimeout(2200);
  await input.pressSequentially("It should save my changes. It's major: I can't save my work.", {
    delay: 45,
  });
  await input.press('Enter');
  const card = page.locator('.chat .card');
  await card.waitFor();
  await page.waitForTimeout(1500);
  const file = await card.getByRole('button', { name: 'File ticket' }).boundingBox();
  await page.mouse.move(file.x + file.width / 2, file.y + file.height / 2, { steps: 25 });
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('.chat .msg.klipp', { hasText: 'labelled' }).waitFor();
  await page.waitForTimeout(2600);
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
const video = await page.video().path();
const seconds = (Date.now() - started) / 1000;
// Two-pass palette for a small, clean GIF.
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-ss',
  '0.6',
  '-t',
  String(seconds),
  '-i',
  video,
  '-vf',
  'fps=10,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop',
  '0',
  output,
]);
rmSync(videos, { recursive: true, force: true });
console.log(`wrote ${output}`);
