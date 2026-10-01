import { expect, test } from '@playwright/test';
import { COMMIT, banner, clipboard, idOf, launcher, openPicker, panel, pick } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('every element written in the app carries a source id', async ({ page }) => {
  await expect(page.locator('h1')).toHaveAttribute('data-klipp', /^[0-9a-z]{8}$/);
  const rows = await page.locator('li').evaluateAll((els) => els.map((el) => el.dataset.klipp));
  expect(rows).toHaveLength(3);
  expect(new Set(rows).size).toBe(1);
});

test('picking names the code without the page reacting', async ({ page }) => {
  await pick(page, page.getByRole('button', { name: 'Count' }));
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 0');
  const dialog = panel(page);
  await expect(dialog).toContainText('<button> in Button');
  await expect(
    dialog.getByRole('link', { name: 'examples/react-app/src/Button.tsx:5:5' }),
  ).toHaveAttribute(
    'href',
    `https://github.com/example/app/blob/${COMMIT}/examples/react-app/src/Button.tsx#L5`,
  );
  await expect(
    dialog.getByRole('link', { name: 'examples/react-app/src/App.tsx:22:11' }),
  ).toBeVisible();
});

test('one component used twice gets two ids from one code site', async ({ page }) => {
  const count = await idOf(page.getByRole('button', { name: 'Count' }));
  const reverse = await idOf(page.getByRole('button', { name: 'Reverse' }));
  expect(count.split('.')[0]).toBe(reverse.split('.')[0]);
  expect(count).not.toBe(reverse);
});

test('a list row keeps its id when the list reorders', async ({ page }) => {
  const beta = page.locator('li', { hasText: 'Beta' });
  const before = await idOf(beta);
  await page.getByRole('button', { name: 'Reverse' }).click();
  await expect(page.locator('li').first()).toHaveText('Gamma');
  expect(await idOf(beta)).toBe(before);
  expect(await idOf(page.locator('li', { hasText: 'Alpha' }))).not.toBe(before);
});

test('a Klipp link opens the page on the same element', async ({ page }) => {
  await pick(page, page.locator('li', { hasText: 'Beta' }).locator('span'));
  const id = (await panel(page).getByTestId('klipp-id').textContent())!;
  await panel(page).getByRole('button', { name: 'Copy link' }).click();
  const link = await clipboard(page);
  expect(link).toContain(`?klipp=${encodeURIComponent(id)}`);

  await page.goto(link);
  await expect(panel(page)).toContainText('Opened from a Klipp link.');
  await expect(panel(page).getByTestId('klipp-id')).toHaveText(id);
  expect(await page.evaluate((text) => window.klipp!.find(text)?.textContent, id)).toBe('Beta');
});

test('a Klipp link that arrives by client-side navigation is followed too', async ({ page }) => {
  // As when an app sends the user through sign-in and back with history.pushState.
  const id = await idOf(page.getByRole('button', { name: 'Reverse' }));
  await page.evaluate((text) => history.pushState({}, '', `?klipp=${text}`), id);
  await expect(panel(page).getByTestId('klipp-id')).toHaveText(id);
});

test('the report links the code and leaves on-screen text out unless asked', async ({ page }) => {
  await pick(page, page.locator('li', { hasText: 'Beta' }).locator('span'));
  const dialog = panel(page);
  await dialog.getByRole('textbox', { name: 'What looks wrong?' }).fill('Wrong unit name');
  await dialog.getByRole('button', { name: 'Copy report' }).click();
  await expect(dialog.getByRole('status')).toHaveText(/Report copied/);
  const report = await clipboard(page);
  expect(report).toContain('### Klipp: `<span>` in `App`');
  expect(report).toContain('> Wrong unit name');
  expect(report).toContain(
    `https://github.com/example/app/blob/${COMMIT}/examples/react-app/src/App.tsx#L`,
  );
  expect(report).not.toContain('Beta');

  await dialog.getByRole('checkbox', { name: /Include the element's text/ }).check();
  await dialog.getByRole('button', { name: 'Copy report' }).click();
  await expect.poll(() => clipboard(page)).toContain('Beta');
});

test('a covered, disabled button says why it cannot be pressed', async ({ page }) => {
  await pick(page, page.getByRole('button', { name: 'Save' }));
  const dialog = panel(page);
  await expect(dialog).toContainText('<div> in App');
  await dialog.getByRole('button', { name: 'Beneath' }).click();
  await expect(dialog).toContainText('<button> in App');
  await expect(dialog).toContainText('disabled');
  await expect(dialog).toContainText(/clicks at its centre land on <div> [0-9a-z]{8}\.[0-9a-z]{4}/);
});

test('arrow keys walk to the parent before picking', async ({ page }) => {
  await openPicker(page);
  await page.locator('li', { hasText: 'Beta' }).locator('span').hover({ force: true });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(panel(page)).toContainText('<li> in App');
});

test('what is under the banner can still be picked, and Cancel still works', async ({ page }) => {
  await openPicker(page);
  const box = (await banner(page).boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await expect(banner(page)).toHaveClass(/faded/);
  await page.mouse.down();
  await page.mouse.up();
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await openPicker(page);
  await banner(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(banner(page)).toBeHidden();
});

test('every mode can be left, and the page works normally after', async ({ page }) => {
  await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(banner(page)).toBeHidden();

  await openPicker(page);
  await page.keyboard.press('Alt+Shift+KeyK');
  await expect(banner(page)).toBeHidden();

  await openPicker(page);
  await banner(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(banner(page)).toBeHidden();

  await pick(page, page.locator('h1'));
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  await pick(page, page.locator('h1'));
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toBeHidden();

  await page.getByRole('button', { name: 'Count' }).click();
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 1');
});

test('the paperclip starts and stops picking', async ({ page }) => {
  await launcher(page).click();
  await expect(banner(page)).toBeVisible();
  await launcher(page).click();
  await expect(banner(page)).toBeHidden();
});
