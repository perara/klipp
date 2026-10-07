import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { expect, test } from '@playwright/test';

test('Smia shows the proxy identity, branded navigation and readiness', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5286/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await page.route('**/ui/api/agents', (route) =>
    route.fulfill({
      json: [
        {
          id: 'claude',
          label: 'Claude',
          version: '9.9.9 (fake)',
          signedIn: false,
          problem: 'Sandbox unavailable. Check the host settings.',
        },
        { id: 'codex', label: 'Codex', version: '9.9.9 (fake)', signedIn: true },
      ],
    }),
  );
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("font-src 'self'");
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page).toHaveTitle('Smia · Klipp');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where Klipp’s agents work.');
  await expect(page.getByRole('status')).toHaveText('Signed in as owner@example.com');
  await expect(page.locator('[data-agent="claude"]')).toContainText('Needs attention');
  await expect(page.locator('[data-agent="codex"] .chip')).toHaveText('Signed in');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await nav.getByRole('link', { name: /Tokens/ }).click();
  await expect(page.getByLabel('Name of the app')).toBeVisible();
  await nav.getByRole('link', { name: /Runs/ }).click();
  await expect(page.getByText(/No runs yet/)).toBeVisible();
  await expect(page.locator('[style],script:not([src])')).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('missing identity and insufficient roles show clear refusal pages', async ({
  browser,
  baseURL,
}) => {
  for (const [headers, status, text] of [
    [{}, 401, 'Sign-in required'],
    [
      { 'X-Klipp-Box-User': 'owner@example.com', 'X-Klipp-Box-Roles': 'tester' },
      403,
      'Access denied',
    ],
  ] as const) {
    const context = await browser.newContext({ extraHTTPHeaders: headers });
    try {
      const page = await context.newPage();
      const response = await page.goto(baseURL!);
      expect(response?.status()).toBe(status);
      await expect(page.getByRole('heading', { name: text })).toBeVisible();
      await expect(page.getByText(/proxy|required role/)).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

test('keyboard navigation has a visible focus ring and labelled token form', async ({ page }) => {
  await page.goto('/#tokens');
  await expect(page.getByLabel('Name of the app')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to workspace' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const field = page.getByLabel('Name of the app');
  await field.focus();
  expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await field.fill('smia-e2e');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.locator('.secret')).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'smia-e2e' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(page.locator('.secret')).toHaveCount(0);
});

test('skipping to the workspace while agents load keeps the arriving view', async ({ page }) => {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/ui/api/agents', async (route) => {
    await pending;
    await route.fulfill({
      json: [{ id: 'claude', label: 'Claude', version: '9.9.9 (fake)', signedIn: false }],
    });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Skip to workspace' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  release();
  await expect(page.locator('[data-agent="claude"]')).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} theme has readable text and fits phone, landscape and desktop`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.route('**/ui/api/agents', (route) =>
      route.fulfill({
        json: [
          { id: 'claude', label: 'Claude', version: '9.9.9 (fake)', signedIn: false },
          { id: 'codex', label: 'Codex', version: '9.9.9 (fake)', signedIn: true },
        ],
      }),
    );
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText('Signed in as owner@example.com');
    await expect(page.locator('button.primary')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px Nunito'))).toBe(true);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      for (const section of ['agents', 'tokens', 'runs']) {
        await page.goto(`/#${section}`);
        await expect(page.getByRole('region', { name: section, exact: false })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
      }
      await page.goto('/#agents');
      await expect(page.locator('[data-agent="claude"]')).toBeVisible();
      const ratios = await page
        .locator('.muted, .chip, button, .eyebrow, .nav-description, .identity')
        .evaluateAll((elements) => {
          const luminance = (css: string) => {
            const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
              const channel = Number(value) / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return elements
            .filter((el) => el.getBoundingClientRect().height > 0)
            .map((el) => {
              let background: Element | null = el;
              while (
                background &&
                getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
              )
                background = background.parentElement;
              const values = [
                luminance(getComputedStyle(el).color),
                luminance(
                  background ? getComputedStyle(background).backgroundColor : 'rgb(255, 255, 255)',
                ),
              ].sort((a, b) => b - a);
              return { text: el.textContent, ratio: (values[0]! + 0.05) / (values[1]! + 0.05) };
            });
        });
      for (const sample of ratios)
        expect(sample.ratio, `${colorScheme}: ${sample.text}`).toBeGreaterThanOrEqual(4.5);
      if (process.env.KLIPP_SMIA_SCREENSHOTS && viewport.width !== 812) {
        await page.screenshot({
          path: `.github/assets/smia/after-${viewport.width === 375 ? 'phone' : 'desktop'}-${colorScheme}.png`,
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':root { font-size: 200%; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
}

test('a run log renders streamed text safely and provides a keyboard-accessible answer', async ({
  page,
}) => {
  const lines = [
    {
      type: 'head',
      id: 'demo',
      app: 'example',
      agent: 'claude',
      started: '2026-10-07T10:00:00Z',
      message: 'Review the checkout flow.',
    },
    { type: 'event', event: { type: 'activity', label: 'Reading the repository' } },
    {
      type: 'event',
      event: {
        type: 'text',
        delta: 'The checkout button needs a clearer label. <script> stays text.',
      },
    },
    { type: 'end', outcome: 'done' },
  ];
  await page.route('**/ui/api/runs/demo', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join(''),
    }),
  );
  await page.goto('/#runs/demo');
  const answer = page.getByLabel('Run answer');
  await expect(answer).toContainText('<script> stays text.');
  await expect(page.getByRole('region', { name: 'Run', exact: true })).toContainText('done');
  await answer.focus();
  await expect(answer).toBeFocused();
  if (process.env.KLIPP_SMIA_SCREENSHOTS)
    await page.screenshot({ path: '.github/assets/smia/after-run.png', fullPage: true });
});

// Capture the released UI with its original modules, using the same fake agents and viewport.
// Opt-in evidence generation; this does not replace the current-page tests above.
test('capture the v0.8.1 page before the Smia redesign', async ({ page }) => {
  test.skip(!process.env.KLIPP_SMIA_SCREENSHOTS, 'Screenshot evidence is opt-in.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/ui/box/ui/*.js', (route) => {
    const file = new URL(route.request().url()).pathname
      .slice('/ui/'.length)
      .replace(/\.js$/, '.ts');
    const source = execFileSync('git', ['show', `v0.8.1:src/${file}`], { encoding: 'utf8' });
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return route.fulfill({ contentType: 'text/javascript', body: outputText });
  });
  await page.route('**/ui/api/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', label: 'Claude', version: '9.9.9 (fake)', signedIn: false },
        { id: 'codex', label: 'Codex', version: '9.9.9 (fake)', signedIn: true },
      ],
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AI box', exact: true })).toBeVisible();
  await expect(page.locator('[data-agent="claude"]')).toBeVisible();
  await page.screenshot({ path: '.github/assets/smia/before-desktop.png', fullPage: true });
});
