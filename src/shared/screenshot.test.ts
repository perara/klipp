import { describe, expect, it } from 'vitest';
import { isScreenshot, MAX_SCREENSHOT_BYTES } from './screenshot.js';
const image = { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1600, height: 900 };
describe('screenshot limits', () => {
  it('accepts capped raster images only', () => {
    expect(isScreenshot(image)).toBe(true);
    for (const change of [
      { mimeType: 'image/svg+xml' },
      { width: 1601 },
      { height: -1 },
      { width: NaN },
      { data: '<script>' },
      { data: 'A'.repeat(666668) },
      { data: 'A'.repeat(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4) },
    ])
      expect(isScreenshot({ ...image, ...change })).toBe(false);
  });
});
