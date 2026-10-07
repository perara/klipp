import { expect, test, type Page } from '@playwright/test';
import { ask, chat, idOf, openChat, replies } from './helpers.js';

async function fixture(page: Page) {
  await page.goto('./');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    canvas.setAttribute('data-klipp', 'a1b2c3d4');
    canvas.id = 'screenshot-canvas';
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 120, 120);
    document.body.prepend(canvas);
  });
  await openChat(page);
}

test('a redacted canvas preview sends nothing until approval and becomes a ticket attachment', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    if (route.request().resourceType() === 'document')
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'Content-Security-Policy': `${testInfo.project.name === 'build' ? "script-src 'self';" : ''} style-src 'self'; img-src 'self' data:; object-src 'none'`,
        },
      });
    else await route.fulfill({ response });
  });
  await fixture(page);
  const answers: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/tool-result')) answers.push(r.postDataJSON() as Record<string, unknown>);
  });
  await ask(page, `screenshot id ${await idOf(page.locator('#screenshot-canvas'))}`);
  const card = chat(page).locator('.screenshot-card');
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  expect(answers).toEqual([]);
  const pixel = await card
    .locator('canvas')
    .evaluate((el) =>
      Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(60, 60, 1, 1).data),
    );
  expect(pixel[0]).toBeGreaterThan(240);
  expect(pixel[1]).toBeLessThan(20);
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(replies(page).last()).toContainText('Image received: image/jpeg');
  const image = answers[0]?.image as { data: string; width: number; height: number };
  expect(Buffer.from(image.data, 'base64').length).toBeLessThanOrEqual(500_000);
  expect(image.width).toBeLessThanOrEqual(1600);
  await ask(page, 'report it');
  await expect(chat(page).getByLabel('Attach approved screenshot')).toBeChecked();
  const filing = page.waitForRequest((r) => r.url().endsWith('/issue'));
  await chat(page).getByRole('button', { name: 'File ticket' }).click();
  expect(((await filing).postDataJSON() as { attachments: string[] }).attachments).toHaveLength(1);
  await expect(replies(page).last()).toContainText('Filed!');
  expect(errors).toEqual([]);
});

test('denial and Escape send no image; each subsequent screenshot requires fresh consent', async ({
  page,
}) => {
  await fixture(page);
  const answers: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/tool-result')) answers.push(r.postDataJSON() as Record<string, unknown>);
  });
  await ask(page, 'screenshot');
  await chat(page).getByRole('button', { name: "Don't send" }).click();
  await expect(replies(page).last()).toContainText('No image was sent');
  expect(answers[0]).not.toHaveProperty('image');
  await ask(page, 'screenshot region');
  await expect(chat(page).getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await chat(page).getByRole('button', { name: "Don't send" }).focus();
  await page.keyboard.press('Escape');
  await expect(chat(page)).toBeHidden();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers[1]).not.toHaveProperty('image');
});

test('caps a large viewport in the active build', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1800 });
  await fixture(page);
  await ask(page, 'screenshot');
  const card = chat(page).locator('.screenshot-card');
  await expect(card.locator('canvas')).toBeVisible();
  const dimensions = await card
    .locator('canvas')
    .evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height]);
  expect(Math.max(...dimensions)).toBeLessThanOrEqual(1600);
  const posted = page.waitForRequest((r) => r.url().endsWith('/tool-result'));
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  const result = (await posted).postDataJSON() as { image: { data: string } };
  expect(Buffer.from(result.image.data, 'base64').length).toBeLessThanOrEqual(500_000);
  await expect(replies(page).last()).toContainText('Image received');
});

test('canvas adapters can provide pixels from their own rendered WebGL frame', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#screenshot-canvas')!;
    const green = document.createElement('canvas');
    green.width = 120;
    green.height = 120;
    const ctx = green.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 120, 120);
    const app = window as unknown as {
      exampleRegisterCanvas: (
        el: Element,
        adapter: { at: () => undefined; screenshot: () => string },
      ) => void;
    };
    app.exampleRegisterCanvas(canvas, { at: () => undefined, screenshot: () => green.toDataURL() });
  });
  await ask(page, `screenshot id ${await idOf(page.locator('#screenshot-canvas'))}`);
  const preview = chat(page).locator('.screenshot-card canvas');
  await expect(preview).toBeVisible();
  const pixel = await preview.evaluate((el) =>
    Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(60, 60, 1, 1).data),
  );
  expect(pixel[1]).toBeGreaterThan(240);
  expect(pixel[0]).toBeLessThan(20);
  await chat(page).getByRole('button', { name: "Don't send" }).click();
});
