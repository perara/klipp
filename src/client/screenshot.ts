import { canvasAdapterFor } from '../canvas/registry.js';
import { MAX_SCREENSHOT_BYTES, type Screenshot } from '../shared/screenshot.js';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Capture {
  image: Screenshot;
  preview: HTMLCanvasElement;
  warnings: string[];
}

/** Re-encode until both the dimension and byte limits hold, never sending an oversized image. */
export function encodeScreenshot(canvas: HTMLCanvasElement): Screenshot {
  const scaled = document.createElement('canvas');
  let factor = Math.min(1, 1600 / canvas.width, 1600 / canvas.height);
  for (let attempt = 0; attempt < 8; attempt++, factor *= 0.75) {
    scaled.width = Math.max(1, Math.floor(canvas.width * factor));
    scaled.height = Math.max(1, Math.floor(canvas.height * factor));
    scaled.getContext('2d')!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    const url = scaled.toDataURL('image/jpeg', 0.75);
    const data = url.slice(url.indexOf(',') + 1);
    const bytes = (data.length * 3) / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes <= MAX_SCREENSHOT_BYTES)
      return { mimeType: 'image/jpeg', data, width: scaled.width, height: scaled.height };
  }
  throw new Error('The screenshot could not fit within 500 KB.');
}

/** Detached, redacted DOM: no original attributes, URLs, values, script or generated content. */
export async function screenshotSvg(region: Region): Promise<{ svg: string; warnings: string[] }> {
  const warnings: string[] = [];
  const pixels = new Map<HTMLCanvasElement, string>();
  // Read native canvases together immediately after a frame. Adapters may render/read their own
  // WebGL frame, or return their cached pixels. Never ask the browser for display permissions.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      for (const canvas of document.querySelectorAll('canvas')) {
        if (canvas.closest('klipp-root, [data-klipp-private]')) continue;
        try {
          pixels.set(canvas, canvas.toDataURL('image/png'));
        } catch {
          warnings.push('A protected canvas was omitted.');
        }
      }
      resolve();
    }),
  );
  const doc = document.implementation.createHTMLDocument('');
  const styles: string[] = [];
  let count = 0;
  const clone = async (node: Node): Promise<Node | undefined> => {
    if (node instanceof Text)
      return doc.createTextNode((node.textContent ?? '').replace(/\S/g, '•'));
    if (
      !(node instanceof Element) ||
      node.matches(
        'klipp-root, script, style, link, meta, iframe, object, embed, [data-klipp-private]',
      )
    )
      return;
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (++count > 10_000)
      throw new Error('This page is too large to capture. Try an element or smaller region.');
    const form = node.matches('input, textarea, select, [contenteditable]');
    const isCanvas = node instanceof HTMLCanvasElement;
    const tag = isCanvas
      ? 'img'
      : form ||
          node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
          node.matches('img, video, audio')
        ? 'div'
        : node.localName;
    const el = doc.createElement(tag);
    const className = `s${count}`;
    el.className = className;
    const css: string[] = [];
    for (let index = 0; index < computed.length; index++) {
      const property = computed.item(index);
      const value = computed.getPropertyValue(property);
      if (
        property.startsWith('--') ||
        /url\(|image-set\(/i.test(value) ||
        /^(content|animation|transition|cursor)/.test(property)
      )
        continue;
      css.push(`${property}:${value}`);
    }
    if (form) css.push('color:transparent', 'background:#adb5bd');
    if (node.matches('img, video')) css.push('background:#adb5bd');
    styles.push(`.${className}{${css.join(';')}}`);
    if (isCanvas) {
      let data = pixels.get(node);
      try {
        const registered = canvasAdapterFor(node);
        data = (await registered?.adapter.screenshot?.(node)) ?? data;
      } catch {
        warnings.push('A canvas adapter could not capture its frame.');
      }
      if (
        data &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data) &&
        data.length < 16_000_000
      )
        el.setAttribute('src', data);
      else warnings.push('A canvas had no readable image.');
    } else if (!form && !node.matches('img, video, audio')) {
      const nodes = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
      for (const child of nodes) {
        const copied = await clone(child);
        if (copied) el.append(copied);
      }
    }
    return el;
  };
  const body = await clone(document.body);
  if (!body) throw new Error('There is no visible page to capture.');
  const rect = document.body.getBoundingClientRect();
  const wrap = doc.createElement('div');
  wrap.className = 'capture-page';
  wrap.append(body);
  const style = doc.createElement('style');
  style.textContent = `${styles.join('\n')} .capture-page{position:absolute;left:${rect.left - region.x}px;top:${rect.top - region.y}px;width:${document.body.clientWidth}px} .capture-page>body{margin:0!important}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(region.width));
  svg.setAttribute('height', String(region.height));
  const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject');
  foreign.setAttribute('width', '100%');
  foreign.setAttribute('height', '100%');
  foreign.append(style, wrap);
  svg.append(foreign);
  return { svg: new XMLSerializer().serializeToString(svg), warnings };
}

export async function captureScreenshot(element?: Element, region?: Region): Promise<Capture> {
  const box =
    region ??
    (element
      ? element.getBoundingClientRect()
      : { x: 0, y: 0, width: innerWidth, height: innerHeight });
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y);
  const crop = {
    x,
    y,
    width: Math.min(innerWidth, box.x + box.width) - x,
    height: Math.min(innerHeight, box.y + box.height) - y,
  };
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.width <= 0 ||
    crop.height <= 0
  )
    throw new Error('The screenshot region is outside the viewport.');
  const { svg, warnings } = await screenshotSvg(crop);
  const image = new Image();
  const loaded = new Promise<void>((done, fail) => {
    image.onload = () => done();
    image.onerror = () =>
      fail(
        new Error(
          'The browser could not render the screenshot. Allow data: in img-src for local DOM capture.',
        ),
      );
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const preview = document.createElement('canvas');
  const factor = Math.min(1, 1600 / crop.width, 1600 / crop.height);
  preview.width = Math.max(1, Math.floor(crop.width * factor));
  preview.height = Math.max(1, Math.floor(crop.height * factor));
  const context = preview.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(image, 0, 0, preview.width, preview.height);
  const encoded = encodeScreenshot(preview);
  // Preview the exact compressed bytes which approval will send.
  const exact = new Image();
  exact.src = `data:${encoded.mimeType};base64,${encoded.data}`;
  await exact.decode();
  preview.width = encoded.width;
  preview.height = encoded.height;
  preview.getContext('2d')!.drawImage(exact, 0, 0);
  return { image: encoded, preview, warnings };
}
