import { expect, type Locator, type Page } from '@playwright/test';
// Brings in the type of `window.klipp`.
import type {} from '../src/client/index.js';

export const COMMIT = '0123456789abcdef0123456789abcdef01234567';

export const figure = (page: Page) => page.getByRole('button', { name: /Klipp: ask about/ });
export const chat = (page: Page) => page.getByRole('dialog', { name: 'Klipp' });
export const hint = (page: Page) => page.locator('.hint');
export const chip = (page: Page) => page.locator('.chip');
export const input = (page: Page) => chat(page).getByRole('textbox', { name: 'Message Klipp' });
export const replies = (page: Page) => chat(page).locator('.msg.klipp');

export async function openChat(page: Page) {
  await figure(page).click();
  await expect(chat(page)).toBeVisible();
}

export async function ask(page: Page, text: string) {
  await input(page).fill(text);
  await input(page).press('Enter');
}

/** Points at an element like a user: the glass covers the page, so the click goes through it. */
export async function pointAt(page: Page, target: Locator) {
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await expect(hint(page)).toBeVisible();
  await target.click({ force: true });
  await expect(chat(page)).toBeVisible();
}

export const idOf = (target: Locator) => target.evaluate((el) => window.klipp!.id(el));
