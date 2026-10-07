/** A locally previewed image. Only a consented tool result may carry it. */
export interface Screenshot {
  mimeType: 'image/jpeg' | 'image/webp';
  data: string;
  width: number;
  height: number;
}

export const MAX_SCREENSHOT_BYTES = 500_000;
export const MAX_SCREENSHOTS = 3;

/** Bounds both tool results and ticket attachments before accepting their bytes. */
export function isScreenshot(value: unknown): value is Screenshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Screenshot;
  return (
    (s.mimeType === 'image/jpeg' || s.mimeType === 'image/webp') &&
    Number.isInteger(s.width) &&
    s.width > 0 &&
    s.width <= 1600 &&
    Number.isInteger(s.height) &&
    s.height > 0 &&
    s.height <= 1600 &&
    typeof s.data === 'string' &&
    s.data.length > 0 &&
    s.data.length <= Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 &&
    s.data.length % 4 === 0 &&
    (s.data.length * 3) / 4 - (s.data.endsWith('==') ? 2 : s.data.endsWith('=') ? 1 : 0) <=
      MAX_SCREENSHOT_BYTES &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(s.data)
  );
}
