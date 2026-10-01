import { expect, test } from '@playwright/test';
import { banner, launcher, panel } from './helpers.js';

test('tap the paperclip, then tap what looks wrong', async ({ page }) => {
  await page.goto('./');
  await launcher(page).tap();
  await expect(banner(page)).toContainText('Tap what looks wrong.');
  await page.getByRole('button', { name: 'Count' }).tap({ force: true });
  await expect(panel(page)).toContainText('<button> in Button');
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 0');

  await panel(page).getByRole('button', { name: 'Close' }).tap();
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: 'Count' }).tap();
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 1');
});
