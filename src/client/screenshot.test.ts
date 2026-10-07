// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeScreenshot, screenshotSvg } from './screenshot.js';
import { ScreenshotCard } from './ui/screenshot.js';
import { registerCanvas } from '../canvas/registry.js';
const region = { x: 0, y: 0, width: 100, height: 100 };
afterEach(() => document.body.replaceChildren());
describe('local screenshot capture', () => {
  it('removes text, attributes, values, private subtrees and media URLs', async () => {
    const p = document.createElement('p');
    p.textContent = 'private text';
    p.setAttribute('title', 'secret title');
    const input = document.createElement('input');
    input.value = 'secret value';
    const privateNode = document.createElement('div');
    privateNode.setAttribute('data-klipp-private', '');
    privateNode.textContent = 'secret subtree';
    const img = document.createElement('img');
    img.src = 'https://private.example/secret';
    document.body.append(p, input, privateNode, img);
    const { svg } = await screenshotSvg(region);
    expect(svg).not.toMatch(/private text|secret|private\.example|<input|<img/);
    expect(svg).toContain('••••••• ••••');
    expect(svg).not.toContain('style=');
  });
  it('uses the registered canvas screenshot adapter', async () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const stop = registerCanvas(canvas, {
      at: () => undefined,
      screenshot: () => 'data:image/png;base64,YWJj',
    });
    expect((await screenshotSvg(region)).svg).toContain('data:image/png;base64,YWJj');
    stop();
  });
  it.each([true, false])('requires a fresh explicit consent decision: %s', async (approve) => {
    const capture = {
      preview: document.createElement('canvas'),
      warnings: [],
      image: { mimeType: 'image/jpeg' as const, data: '/9j/2Q==', width: 1, height: 1 },
    };
    const card = new ScreenshotCard(capture);
    document.body.append(card.element);
    card.element.querySelectorAll('button')[approve ? 0 : 1]!.click();
    expect(await card.decision).toBe(approve);
    expect(card.element.textContent).toContain(approve ? 'Approved for the agent' : 'Not sent');
  });
  it('expires by denying and removing the preview', async () => {
    const card = new ScreenshotCard({
      preview: document.createElement('canvas'),
      warnings: [],
      image: { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1, height: 1 },
    });
    card.deny();
    expect(await card.decision).toBe(false);
    expect(card.element.querySelector('canvas')).toBeNull();
  });
});

it('downscales again when the first JPEG exceeds the byte cap', () => {
  const source = document.createElement('canvas');
  source.width = 2000;
  source.height = 1000;
  const context = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValueOnce(`data:image/jpeg;base64,${'A'.repeat(666668)}`)
    .mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
  try {
    const image = encodeScreenshot(source);
    expect(image).toMatchObject({ width: 1200, height: 600, data: '/9j/2Q==' });
    expect(encode).toHaveBeenCalledTimes(2);
  } finally {
    context.mockRestore();
    encode.mockRestore();
  }
});
