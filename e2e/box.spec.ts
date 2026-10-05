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
const fromThePage = {
  'X-Klipp': '1',
  Origin: `http://127.0.0.1:${process.env.KLIPP_BOX_PORT ?? '5284'}`,
};

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

/** What the page is told about the agents, so a test needs nothing an earlier test left. */
async function stubAgents(page: Page, signedIn: { claude: boolean; codex: boolean }) {
  await page.route('**/ui/api/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', label: 'Claude', version: '9.9.9 (fake)', signedIn: signedIn.claude },
        { id: 'codex', label: 'Codex', version: '9.9.9 (fake)', signedIn: signedIn.codex },
      ],
    }),
  );
}

/** The agent's card, signed out whatever it was before: a test starts here, not from a test before. */
async function signedOut(page: Page, id: string) {
  const card = page.locator(`[data-agent="${id}"]`);
  await expect(card).toContainText(/Signed in|Not signed in/);
  const signOut = card.getByRole('button', { name: 'Sign out' });
  if (await signOut.count()) {
    await signOut.click();
    await expect(card).toContainText('Not signed in');
  }
  return card;
}

// One box for the file, started fresh by test/box-server.mjs: Codex signed in, Claude not. Each test
// says what it needs; those that sign an agent in or out of the real box start from a known state
// themselves, and those that only need the page to see some state stub the list of agents. The
// file ends with Claude signed in (the last test that changes it is the one about a refused code).
test.describe.serial('the AI box', () => {
  // Needs: the box as it starts. Leaves: Claude signed in.
  test('shows each agent, and signs Claude in with the code pasted back', async ({ page }) => {
    const errors = watch(page);
    const response = await page.goto('/');
    // Nothing but the box's own scripts, styles and API.
    expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
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

  // Needs: nothing (Codex is signed out first). Leaves: Codex signed out, Claude as it was.
  test('a sign-in shows Codex’s device code and can be cancelled', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/');
    const codex = await signedOut(page, 'codex');
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.locator('code')).toHaveText('ABCD-EFGH');
    await codex.getByRole('button', { name: 'Cancel' }).click();
    await expect(codex).toContainText('Cancelled.');
    expect(errors).toEqual([]);
  });

  // Needs: nothing.
  test('makes a token, shows it once, and revokes it', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/#tokens');
    await expect(page.getByRole('cell', { name: 'example' })).toBeVisible();
    await expect(page.getByText('from environment')).toBeVisible();
    for (const heading of ['App', 'Last used', 'Action']) {
      await expect(page.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    await page.getByRole('textbox', { name: 'Name of the app' }).fill('square-dev');
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(page.locator('pre.secret')).toHaveText(/^kbox_/);
    const row = page.getByRole('row', { name: /square-dev/ });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toBeHidden();
    // The secret of a revoked token is no use, so it goes with it.
    await expect(page.locator('pre.secret')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  // Needs: nothing.
  test('a new token is shown once: leaving the page and coming back hides it', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/#tokens');
    await page.getByRole('textbox', { name: 'Name of the app' }).fill('shown-once');
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(page.locator('pre.secret')).toHaveText(/^kbox_/);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await sections.getByRole('link', { name: 'Agents' }).click();
    await expect(page.getByRole('region', { name: 'Agents' })).toBeVisible();
    await sections.getByRole('link', { name: 'Tokens' }).click();
    const row = page.getByRole('row', { name: /shown-once/ });
    await expect(row).toBeVisible();
    await expect(page.locator('pre.secret')).toHaveCount(0);
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toBeHidden();
    expect(errors).toEqual([]);
  });

  // Needs: nothing.
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

  // Needs: nothing (Claude is signed out first). Leaves: Claude signed in.
  test('a code the box refuses is said so, and the form stays for the right one', async ({
    page,
  }) => {
    const errors = watch(page);
    await page.goto('/');
    const claude = await signedOut(page, 'claude');
    await claude.getByRole('button', { name: 'Sign in' }).click();
    await claude.getByRole('button', { name: 'Send code' }).click();
    await expect(claude.getByRole('alert')).toHaveText('That code could not be sent.');
    await claude.getByRole('textbox', { name: 'Code from the sign-in page' }).fill('good-code');
    await claude.getByRole('button', { name: 'Send code' }).click();
    await expect(claude).toContainText('Signed in');
    expect(besidesRefusals(errors)).toEqual([]);
  });

  // Needs: nothing (Codex is signed out first). Leaves: Codex signed out.
  test('a cancel the box refuses is said so, and can be tried again', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/');
    const codex = await signedOut(page, 'codex');
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

  // Needs: nothing (the agents and the refusals are stubbed).
  test('a refused sign-in or sign-out is said so in the agent’s card', async ({ page }) => {
    const errors = watch(page);
    await stubAgents(page, { claude: true, codex: false });
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
    // A refused sign-in is no sign-in under way: the button is there to try again.
    await expect(
      page.locator('[data-agent="codex"]').getByRole('button', { name: 'Sign in' }),
    ).toBeVisible();
    expect(besidesRefusals(errors)).toEqual([]);
  });

  // Needs: nothing (the agents, the sign-in and its stream are stubbed).
  test('a sign-in stream that fails says so, and is not reopened', async ({ page }) => {
    const errors = watch(page);
    const streams = await trackStreams(page);
    await stubAgents(page, { claude: true, codex: false });
    // A sign-in that starts, and a stream that never opens.
    await page.route('**/ui/api/agents/codex/login', (route) =>
      route.fulfill({ json: { login: 'lost' } }),
    );
    await page.route('**/ui/api/logins/lost', (route) => route.abort());
    await page.goto('/');
    const codex = page.locator('[data-agent="codex"]');
    await codex.getByRole('button', { name: 'Sign in' }).click();
    await expect(codex.getByRole('alert')).toHaveText('The sign-in stream ended.');
    expect(await streams()).toEqual([2]);
    await expect(codex.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(besidesRefusals(errors)).toEqual([]);
  });

  // Needs: nothing (the run stream is stubbed).
  test('a run stream that ends before the run does says so', async ({ page }) => {
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
    await expect(run.getByRole('alert')).toHaveText("The run's stream ended before the run did.");
    expect(await streams()).toEqual([2]);
    expect(besidesRefusals(errors)).toEqual([]);
  });

  // Needs: nothing.
  test('a run that is not there says so instead of staying at Loading', async ({ page }) => {
    const errors = watch(page);
    const streams = await trackStreams(page);
    await page.goto('/#runs/bogus');
    const run = page.getByRole('region', { name: 'Run' });
    await expect(run.getByRole('alert')).toHaveText("The run's stream ended before the run did.");
    await expect(run).not.toContainText('Loading');
    expect(await streams()).toEqual([2]);
    expect(besidesRefusals(errors)).toEqual([]);
  });

  // Needs: nothing (the list of runs is stubbed).
  test('the runs list has headings for its columns', async ({ page }) => {
    const errors = watch(page);
    await page.route('**/ui/api/runs', (route) =>
      route.fulfill({
        json: [
          {
            id: 'one',
            app: 'example',
            agent: 'claude',
            started: '2026-10-05T10:00:00.000Z',
            live: false,
            outcome: 'done',
          },
        ],
      }),
    );
    await page.goto('/#runs');
    for (const heading of ['Started', 'App', 'Agent', 'Outcome']) {
      await expect(page.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    await expect(page.getByRole('cell', { name: 'done' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  // Needs: nothing (the agents are stubbed).
  test('a primary button is readable in the light and in the dark', async ({ page }) => {
    const errors = watch(page);
    await stubAgents(page, { claude: false, codex: true });
    await page.goto('/');
    const button = page.locator('button.primary').first();
    await expect(button).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      // WCAG contrast of the button's text on its fill.
      const ratio = await button.evaluate((el) => {
        const luminance = (css: string) => {
          const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(el);
        const [light = 0, dark = 0] = [
          luminance(style.color),
          luminance(style.backgroundColor),
        ].sort((a, b) => b - a);
        return (light + 0.05) / (dark + 0.05);
      });
      expect(ratio, colorScheme).toBeGreaterThanOrEqual(4.5);
    }
    expect(errors).toEqual([]);
  });

  // Needs: nothing (the agents are stubbed; Claude's sign-in is the box's own, and is cancelled).
  test('a sign-in under way keeps its card while another agent is signed out', async ({ page }) => {
    const errors = watch(page);
    const state = { claude: false, codex: true };
    await stubAgents(page, state);
    await page.route('**/ui/api/agents/codex/logout', (route) => {
      state.codex = false;
      return route.fulfill({ status: 204 });
    });
    await page.goto('/');
    const claude = page.locator('[data-agent="claude"]');
    const codex = page.locator('[data-agent="codex"]');
    await claude.getByRole('button', { name: 'Sign in' }).click();
    const code = claude.getByRole('textbox', { name: 'Code from the sign-in page' });
    await expect(code).toBeVisible();
    // One mode at a time: no second sign-in while this one is under way.
    await expect(claude.getByRole('button', { name: 'Sign in' })).toBeHidden();
    await code.fill('half-typed');
    await codex.getByRole('button', { name: 'Sign out' }).click();
    await expect(codex).toContainText('Not signed in');
    // The list was read again, and Claude's card is as it was: field, text, button.
    await expect(code).toHaveValue('half-typed');
    await expect(claude.getByRole('button', { name: 'Sign in' })).toBeHidden();
    await claude.getByRole('button', { name: 'Cancel' }).click();
    // Its stream was still open to say so, and the card can start again.
    await expect(claude).toContainText('Cancelled.');
    await expect(claude.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  // Needs: nothing.
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

  // Needs: Claude signed in (an earlier test does it); the example app on 5285 uses the box.
  test('the example app talks through Klipp to the box, page tools included, and the run shows', async ({
    page,
  }) => {
    const errors = watch(page);
    await page.goto('http://127.0.0.1:5285/');
    await page.getByRole('button', { name: /Klipp: ask about/ }).click();
    const chat = page.getByRole('dialog', { name: 'Klipp' });
    await chat.getByRole('textbox', { name: 'Message Klipp' }).fill('the button is broken');
    await chat.getByRole('textbox', { name: 'Message Klipp' }).press('Enter');
    // The box's agent asks the page to point; the answer comes back through Klipp.
    await expect(page.locator('.hint')).toContainText('Click the button you mean.');
    await page.getByRole('button', { name: 'Count' }).click({ force: true });
    await expect(chat.locator('.msg.klipp').last()).toContainText('I read it:');

    await page.goto('/#runs');
    await page.getByRole('region', { name: 'Runs' }).getByRole('link').first().click();
    const run = page.getByRole('region', { name: 'Run' });
    await expect(run).toContainText('example · claude');
    await expect(run.locator('pre.answer')).toContainText('I read it:');
    await expect(run).toContainText('Asked the app: point_at_element');
    expect(errors).toEqual([]);
  });
});
