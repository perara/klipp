import { expect, test } from '@playwright/test';

test.describe.serial('the AI box', () => {
  test('shows each agent, and signs Claude in with the code pasted back', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    const claude = page.locator('[data-agent="claude"]');
    await expect(claude).toContainText('Not signed in');
    await expect(claude).toContainText('9.9.9 (fake)');
    await expect(page.locator('[data-agent="codex"]')).toContainText('Signed in');
    // Styled through CSSOM under the page's CSP.
    expect(await page.locator('header').evaluate((el) => getComputedStyle(el).display)).toBe(
      'flex',
    );
    await claude.getByRole('button', { name: 'Sign in' }).click();
    await expect(claude.getByRole('link', { name: /claude\.example/ })).toBeVisible();
    await claude.getByRole('textbox', { name: 'Code from the sign-in page' }).fill('good-code');
    await claude.getByRole('button', { name: 'Send code' }).click();
    await expect(claude).toContainText('Signed in');
    expect(errors).toEqual([]);
  });

  test('a sign-in shows Codex’s device code and can be cancelled', async ({ page }) => {
    await page.goto('/');
    // Codex, so Claude stays signed in for the chain test below.
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', { name: 'Sign out' }).click();
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.locator('code')).toHaveText('ABCD-EFGH');
    await codex.getByRole('button', { name: 'Cancel' }).click();
    await expect(codex).toContainText('Cancelled.');
  });

  test('makes a token, shows it once, and revokes it', async ({ page }) => {
    await page.goto('/#tokens');
    await expect(page.getByRole('cell', { name: 'example' })).toBeVisible();
    await expect(page.getByText('from environment')).toBeVisible();
    await page.getByRole('textbox', { name: 'Name of the app' }).fill('square-dev');
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(page.locator('pre.secret')).toHaveText(/^kbox_/);
    const row = page.getByRole('row', { name: /square-dev/ });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toBeHidden();
  });
});
