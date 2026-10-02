import { expect, test } from '@playwright/test';
import {
  ask,
  chat,
  chip,
  figure,
  hint,
  idOf,
  input,
  openChat,
  pointAt,
  replies,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('every element written in the app carries a source id', async ({ page }) => {
  await expect(page.locator('h1')).toHaveAttribute('data-klipp', /^[0-9a-z]{8}$/);
  const rows = await page.locator('li').evaluateAll((els) => els.map((el) => el.dataset.klipp));
  expect(rows).toHaveLength(3);
  expect(new Set(rows).size).toBe(1);
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

test('the paperclip opens a chat that answers', async ({ page }) => {
  await openChat(page);
  await expect(replies(page).first()).toContainText("Hi, I'm Klipp!");
  await ask(page, 'hello');
  await expect(chat(page).locator('.msg.user')).toHaveText('hello');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');
});

test('Klipp asks you to point, then reads the code behind it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'the button is broken');
  await expect(hint(page)).toContainText('Click the button you mean.');
  await expect(chat(page)).toBeHidden();
  await page.getByRole('button', { name: 'Count' }).click({ force: true });
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 0');
  await expect(chat(page).locator('.activity')).toHaveText(
    'Reading examples/react-app/src/Button.tsx',
  );
  await expect(replies(page).last()).toHaveText(
    'I read it: <button type="button" className="btn" onClick={onClick}>',
  );
});

test('after pointing, the next message is about that element', async ({ page }) => {
  await openChat(page);
  await pointAt(page, page.getByRole('button', { name: 'Count' }));
  await expect(chip(page)).toContainText('<button> in Button');
  await ask(page, 'what is this?');
  await expect(replies(page).last()).toHaveText('You pointed at <button> in Button.');
  await expect(chip(page)).toBeHidden();
});

test('the model is told why a covered, disabled button cannot be pressed', async ({ page }) => {
  await openChat(page);
  await pointAt(page, page.getByRole('button', { name: 'Save' }));
  await ask(page, 'describe it');
  await expect(replies(page).last()).toContainText('div; states: none; beneath: button');

  const save = await idOf(page.getByRole('button', { name: 'Save' }));
  await page.goto(`./?klipp=${save}`);
  await expect(chip(page)).toContainText('<button> in App');
  await ask(page, 'describe it');
  await expect(replies(page).last()).toContainText(
    /button; states: disabled, clicks at its centre land on <div> [0-9a-z]{8}\.[0-9a-z]{4}/,
  );
});

test('a bug becomes a ticket that is filed only when you say so, labelled as a bug', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'please report this');
  const card = chat(page).locator('.card');
  await expect(card.locator('.badge')).toHaveText('Bug');
  await expect(card.locator('.tag')).toHaveText('major');
  await expect(card.locator('.card-title')).toHaveText('Count does nothing');
  await card.getByText('Show the ticket').click();
  await expect(card.locator('.card-body')).toContainText('Steps to reproduce');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(replies(page).last()).toHaveText("OK, I won't file it.");

  await ask(page, 'report it after all');
  const second = chat(page).locator('.card').last();
  await second.getByRole('button', { name: 'File ticket' }).click();
  await expect(second.getByRole('link')).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/example\/app\/issues\/\d+#labels=bug,klipp$/,
  );
  await expect(replies(page).last()).toHaveText('Filed! 📎');
});

test('a feature request needs the need behind it before it is shown', async ({ page }) => {
  await openChat(page);
  await ask(page, 'I have an idea: a dark mode toggle');
  await expect(replies(page).last()).toHaveText(
    'What do you need it for? (missing for a feature request)',
  );
  await expect(chat(page).locator('.card')).toHaveCount(0);
  await ask(page, 'idea: dark mode, because the control room is dark at night');
  const card = chat(page).locator('.card');
  await expect(card.locator('.badge')).toHaveText('Feature request');
  await card.getByRole('button', { name: 'File ticket' }).click();
  await expect(card.getByRole('link')).toHaveAttribute('href', /#labels=enhancement,klipp$/);
});

test('a suggestion is labelled as one', async ({ page }) => {
  await openChat(page);
  await ask(page, 'I suggest renaming Reverse');
  const card = chat(page).locator('.card');
  await expect(card.locator('.badge')).toHaveText('Suggestion');
  await card.getByRole('button', { name: 'File ticket' }).click();
  await expect(card.getByRole('link')).toHaveAttribute('href', /#labels=suggestion,klipp$/);
});

test('an agent that fails says how to fix it, and the next message works', async ({ page }) => {
  await openChat(page);
  await ask(page, 'break please');
  await expect(replies(page).last()).toContainText('OAuth session expired');
  await expect(replies(page).last()).toContainText('log in');
  await ask(page, 'hello again');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');
});

test('the newest reply and ticket stay in view as the conversation grows', async ({ page }) => {
  await openChat(page);
  for (let i = 0; i < 8; i++) {
    await ask(page, `hello ${i}`);
    await expect(replies(page)).toHaveCount(i + 2);
  }
  await expect(replies(page).last()).toBeInViewport({ ratio: 1 });
  await ask(page, 'please report this');
  const fileTicket = chat(page).locator('.card').getByRole('button', { name: 'File ticket' });
  await expect(fileTicket).toBeInViewport({ ratio: 1 });
});

test('the conversation carries on from one message to the next', async ({ page }) => {
  await openChat(page);
  await ask(page, 'remember pineapple');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');
  await ask(page, 'what did I say?');
  await expect(replies(page).last()).toHaveText('You said: remember pineapple');
});

test('you can switch between Claude and Codex', async ({ page }) => {
  await openChat(page);
  const agents = chat(page).getByRole('group', { name: 'Who answers' });
  await expect(agents.getByRole('button', { name: 'Claude' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await ask(page, 'who are you?');
  await expect(replies(page).last()).toHaveText('I am Claude, in a paperclip.');

  await agents.getByRole('button', { name: 'Codex' }).click();
  await expect(replies(page).last()).toHaveText(
    'Codex is answering now, starting a fresh conversation.',
  );
  await ask(page, 'who are you?');
  await expect(replies(page).last()).toHaveText('I am Codex, in a paperclip.');

  await ask(page, 'the button is broken');
  await expect(hint(page)).toContainText('Click the button you mean.');
  await page.getByRole('button', { name: 'Count' }).click({ force: true });
  await expect(chat(page).locator('.activity').last()).toHaveText(
    'Running sed -n 5p examples/react-app/src/Button.tsx',
  );
  await expect(replies(page).last()).toContainText('I read it:');

  await page.reload();
  await openChat(page);
  await expect(agents.getByRole('button', { name: 'Codex' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('typing instead of deciding on a ticket answers it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'report this');
  await expect(chat(page).locator('.card')).toContainText('Count does nothing');
  await ask(page, 'not yet, look closer');
  await expect(replies(page).last()).toHaveText(
    "Noted: The user didn't file it, and wrote instead: not yet, look closer",
  );
  await expect(chat(page).locator('.card').getByRole('button', { name: 'File issue' })).toHaveCount(
    0,
  );
});

test('a Klipp link opens the chat on that element', async ({ page }) => {
  const id = await idOf(page.locator('li', { hasText: 'Beta' }));
  await page.goto(`./?klipp=${id}`);
  await expect(replies(page).last()).toContainText(
    'This is the element from the link: <li> in App',
  );
  await expect(chip(page)).toContainText('<li> in App');
  expect(await page.evaluate((text) => window.klipp!.find(text)?.textContent, id)).toBe('Beta');
});

test('a Klipp link that arrives by client-side navigation is followed too', async ({ page }) => {
  // As when an app sends the user through sign-in and back with history.pushState.
  const id = await idOf(page.getByRole('button', { name: 'Reverse' }));
  await page.evaluate((text) => history.pushState({}, '', `?klipp=${text}`), id);
  await expect(chip(page)).toContainText('<button> in Button');
});

test('arrow keys walk to the parent before picking', async ({ page }) => {
  await openChat(page);
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await page.locator('li', { hasText: 'Beta' }).locator('span').hover({ force: true });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(chip(page)).toContainText('<li> in App');
});

test('what is under the pointing hint can still be picked', async ({ page }) => {
  await openChat(page);
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  const box = (await hint(page).boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(chip(page)).toBeVisible();
});

test("typing and pointing in Klipp never reach the page's own listeners", async ({ page }) => {
  await openChat(page);
  await ask(page, 'hello');
  await expect(replies(page).last()).toHaveText('Hello! I am a test paperclip.');
  await input(page).press('Backspace');
  await pointAt(page, page.getByRole('button', { name: 'Count' }));
  await expect(page.getByTestId('page-events')).toHaveText('Page events: 0');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reverse' }).click();
  await expect(page.getByTestId('page-events')).not.toHaveText('Page events: 0');
});

test('every mode can be left, and the page works normally after', async ({ page }) => {
  await openChat(page);
  await page.keyboard.press('Escape');
  await expect(chat(page)).toBeHidden();

  await page.keyboard.press('Alt+Shift+KeyK');
  await expect(chat(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press('Alt+Shift+KeyK');
  await expect(chat(page)).toBeHidden();

  await openChat(page);
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await page.keyboard.press('Escape');
  await expect(hint(page)).toBeHidden();
  await expect(chat(page)).toBeVisible();

  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await hint(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(chat(page)).toBeVisible();

  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await figure(page).click();
  await expect(hint(page)).toBeHidden();

  await chat(page).getByRole('button', { name: 'Close' }).click();
  await expect(chat(page)).toBeHidden();

  await page.getByRole('button', { name: 'Count' }).click();
  await expect(page.getByTestId('clicks')).toHaveText('Clicks: 1');
});
