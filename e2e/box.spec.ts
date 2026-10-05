import { expect, test, type Page } from '@playwright/test';

/** What the page logged as an error, and every uncaught exception or unhandled rejection. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** A refusal the test provokes is also logged by the browser itself; nothing else may be. */
const besidesRefusals = (errors: string[]) =>
  errors.filter((error) => !error.startsWith('Failed to load resource'));

/** What the page itself sends: the header and the origin the box asks for. */
const fromThePage = { 'X-Klipp': '1', Origin: 'http://127.0.0.1:5284' };

/** Remembers every EventSource the page opens, so a test can see that none is left open. */
async function trackStreams(page: Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const sources: EventSource[] = [];
    Object.assign(window, { sources });
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        sources.push(this);
      }
    };
  });
  /** 0 connecting, 1 open, 2 closed. */
  return () =>
    page.evaluate(() =>
      (window as unknown as { sources: EventSource[] }).sources.map((source) => source.readyState),
    );
}

test.describe.serial('the AI box', () => {
  test('shows each agent, and signs Claude in with the code pasted back', async ({ page }) => {
    const errors = watch(page);
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
    const errors = watch(page);
    await page.goto('/');
    // Codex, so Claude stays signed in for the chain test below.
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', { name: 'Sign out' }).click();
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.locator('code')).toHaveText('ABCD-EFGH');
    await codex.getByRole('button', { name: 'Cancel' }).click();
    await expect(codex).toContainText('Cancelled.');
    expect(errors).toEqual([]);
  });

  test('makes a token, shows it once, and revokes it', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/#tokens');
    await expect(page.getByRole('cell', { name: 'example' })).toBeVisible();
    await expect(page.getByText('from environment')).toBeVisible();
    await page.getByRole('textbox', { name: 'Name of the app' }).fill('square-dev');
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(page.locator('pre.secret')).toHaveText(/^kbox_/);
    const row = page.getByRole('row', { name: /square-dev/ });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a token revoked elsewhere says so when it is revoked again', async ({ page }) => {
    const errors = watch(page);
    const headers = { ...fromThePage, 'Content-Type': 'application/json' };
    await page.request.post('/ui/api/tokens', { headers, data: { name: 'gone-elsewhere' } });
    await page.goto('/#tokens');
    const row = page.getByRole('row', { name: /gone-elsewhere/ });
    await expect(row).toBeVisible();
    expect((await page.request.delete('/ui/api/tokens/gone-elsewhere', { headers })).status()).toBe(
      204,
    );
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('alert')).toContainText('No such token');
    // The list is read again, so the stale row goes.
    await expect(row).toBeHidden();
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('a code the box refuses is said so, and the form stays for the right one', async ({
    page,
  }) => {
    const errors = watch(page);
    await page.goto('/');
    const claude = page.locator('[data-agent="claude"]');
    await claude.getByRole('button', { name: 'Sign out' }).click();
    await claude.getByRole('button', { name: 'Sign in' }).click();
    await claude.getByRole('button', { name: 'Send code' }).click();
    await expect(claude.getByRole('alert')).toHaveText('That code could not be sent.');
    await claude.getByRole('textbox', { name: 'Code from the sign-in page' }).fill('good-code');
    await claude.getByRole('button', { name: 'Send code' }).click();
    await expect(claude).toContainText('Signed in');
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('a cancel the box refuses is said so, and can be tried again', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/');
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.locator('code')).toHaveText('ABCD-EFGH');
    await page.route('**/ui/api/logins/*', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 404, json: { error: 'No such sign-in.' } })
        : route.continue(),
    );
    await codex.getByRole('button', { name: 'Cancel' }).click();
    await expect(codex.getByRole('alert')).toHaveText('No such sign-in.');
    await expect(codex.locator('code')).toHaveText('ABCD-EFGH');
    await page.unroute('**/ui/api/logins/*');
    await codex.getByRole('button', { name: 'Cancel' }).click();
    await expect(codex).toContainText('Cancelled.');
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('a refused sign-in or sign-out is said so in the agent’s card', async ({ page }) => {
    const errors = watch(page);
    await page.route('**/ui/api/agents/*/*', (route) =>
      route.fulfill({ status: 403, json: { error: 'Not allowed.' } }),
    );
    await page.goto('/');
    for (const { id, button } of [
      { id: 'codex', button: 'Sign in' },
      { id: 'claude', button: 'Sign out' },
    ]) {
      const card = page.locator(`[data-agent="${id}"]`);
      await card.getByRole('button', { name: button }).click();
      await expect(card.getByRole('alert')).toHaveText('Not allowed.');
    }
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('a sign-in stream that fails says the box was lost, and is not reopened', async ({
    page,
  }) => {
    const errors = watch(page);
    const streams = await trackStreams(page);
    // A sign-in that starts, and a stream that never opens.
    await page.route('**/ui/api/agents/codex/login', (route) =>
      route.fulfill({ json: { login: 'lost' } }),
    );
    await page.route('**/ui/api/logins/lost', (route) => route.abort());
    await page.goto('/');
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.getByRole('alert')).toHaveText('Lost the connection to the box.');
    expect(await streams()).toEqual([2]);
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('a run stream that ends before the run does says the box was lost', async ({ page }) => {
    const errors = watch(page);
    const streams = await trackStreams(page);
    const head = { type: 'head', id: 'cut', app: 'example', agent: 'claude', message: 'Hi' };
    await page.route('**/ui/api/runs/cut', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ ...head, started: '2026-10-05T10:00:00.000Z' })}\n\n`,
      }),
    );
    await page.goto('/#runs/cut');
    const run = page.getByRole('region', { name: 'Run' });
    await expect(run).toContainText('example · claude');
    await expect(run.getByRole('alert')).toHaveText('Lost the connection to the box.');
    expect(await streams()).toEqual([2]);
    expect(besidesRefusals(errors)).toEqual([]);
  });

  test('the latest route change wins over a slower one before it', async ({ page }) => {
    const errors = watch(page);
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    await page.route('**/ui/api/agents', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/');
    await page.evaluate(() => (location.hash = 'tokens'));
    await expect(page.getByRole('region', { name: 'Tokens' })).toBeVisible();
    // Now the Agents answer comes, late. It must not replace what is on the page.
    const late = page.waitForResponse('**/ui/api/agents');
    release();
    await late;
    await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
    await expect(page.getByRole('region', { name: 'Tokens' })).toBeVisible();
    await expect(page.locator('[data-agent]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
