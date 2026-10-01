import { expect, type Locator, type Page } from '@playwright/test';
// Brings in the type of `window.klipp`.
import type {} from '../src/client/index.js';

export const COMMIT = '0123456789abcdef0123456789abcdef01234567';

export const panel = (page: Page) => page.getByRole('dialog', { name: /^Klipp:/ });
export const banner = (page: Page) => page.locator('.banner');
export const launcher = (page: Page) =>
  page.getByRole('button', { name: /Klipp: point at something/ });

export async function openPicker(page: Page) {
  await page.keyboard.press('Alt+Shift+KeyK');
  await expect(banner(page)).toBeVisible();
}

/** Picks like a user: the glass covers the page, so the click is forced through it at the element's centre. */
export async function pick(page: Page, target: Locator) {
  await openPicker(page);
  await target.click({ force: true });
  await expect(panel(page)).toBeVisible();
}

export const idOf = (target: Locator) => target.evaluate((el) => window.klipp!.id(el));

export const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
