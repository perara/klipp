import { expect, test } from '@playwright/test';
import { ask, chat, openChat, replies } from './helpers.js';

// The dev server with chat.allowRemote, reached as laptop.test: another device on the network.
test('another device is turned away until it pairs with the printed code', async ({ page }) => {
  await page.goto('./');
  await openChat(page);
  await expect(replies(page).last()).toContainText('Pair this device first');

  await page.goto('./?klipp-pair=WRONG-CODE-1&demo=1');
  await expect(chat(page).getByText('That is not the code the dev server printed.')).toBeVisible();
  // The code leaves the address bar at once, right or wrong.
  expect(new URL(page.url()).search).toBe('?demo=1');

  await page.goto('./?demo=1&klipp-pair=e2e-pair-code');
  await expect(replies(page).last()).toHaveText('This device is paired. Tell me what you noticed!');
  expect(new URL(page.url()).search).toBe('?demo=1');
  await ask(page, 'hi');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');

  // The pairing is a cookie: it lasts across loads.
  await page.reload();
  await openChat(page);
  await ask(page, 'hi');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');
  await expect(chat(page).getByText('Pair this device first')).toHaveCount(0);
});
