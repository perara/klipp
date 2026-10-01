import { expect, test } from '@playwright/test';
import { chat, chip, figure, hint } from './helpers.js';

test('tap the paperclip, point with a tap, close with a tap', async ({ page }) => {
  await page.goto('./');
  await figure(page).tap();
  await expect(chat(page)).toBeVisible();
  await chat(page).getByRole('button', { name: 'Point at something' }).tap();
  await expect(hint(page)).toBeVisible();
  await page.getByRole('button', { name: 'Count' }).tap({ force: true });
  await expect(chip(page)).toContainText('<button> in Button');
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 0');

  await chat(page).getByRole('button', { name: 'Close' }).tap();
  await expect(chat(page)).toBeHidden();
  await page.getByRole('button', { name: 'Count' }).tap();
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 1');
});
