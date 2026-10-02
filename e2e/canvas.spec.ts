import { expect, test, type Page } from '@playwright/test';
import { ask, chat, chip, hint, idOf, openChat, pointAt, replies } from './helpers.js';

interface ExampleMap {
  loaded(): boolean;
  project(lngLat: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
}

/** Where the example map draws a coordinate, once it has loaded. */
async function onMap(page: Page, lng: number, lat: number) {
  await page.waitForFunction(
    () => (window as unknown as { exampleMap?: ExampleMap }).exampleMap?.loaded() === true,
  );
  return page.evaluate(
    ([lng, lat]) => {
      const map = (window as unknown as { exampleMap: ExampleMap }).exampleMap;
      const point = map.project([lng!, lat!]);
      const frame = map.getCanvas().getBoundingClientRect();
      return { x: frame.left + point.x, y: frame.top + point.y };
    },
    [lng, lat],
  );
}

/** Where the example scene draws the crate's centre (x = -1.4, camera at z = 6, fov 50). */
async function crate(page: Page) {
  const scene = page.getByTestId('scene');
  await scene.scrollIntoViewIfNeeded();
  await expect(scene.locator('canvas')).toBeVisible();
  const box = (await scene.boundingBox())!;
  const halfWidth = 6 * Math.tan((25 * Math.PI) / 180) * (box.width / box.height);
  return { x: box.x + ((-1.4 / halfWidth + 1) / 2) * box.width, y: box.y + box.height / 2 };
}

/** Points like a user at a spot on the page, through the glass. */
async function pointAtSpot(page: Page, spot: { x: number; y: number }) {
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  await expect(hint(page)).toBeVisible();
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);
  await expect(chat(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./canvas.html');
});

test('a map feature is pointed at by its layer and id, without its private properties', async ({
  page,
}) => {
  const area = await onMap(page, 8.595, 58.25);
  await openChat(page);
  await pointAtSpot(page, area);
  await expect(chip(page)).toContainText('Polygon 1 in layer search-areas (IncidentMap)');
  await ask(page, 'describe it');
  const reply = replies(page).last();
  await expect(reply).toContainText(/@search-areas%3A1 draws Polygon 1 in layer search-areas/);
  await expect(reply).toContainText('property.kind=search-area');
  await expect(reply).toContainText('properties=name, kind');
  await expect(reply).not.toContainText('North sector');
});

test('empty map is the canvas itself, and a point feature is told apart from the area', async ({
  page,
}) => {
  const post = await onMap(page, 8.635, 58.25);
  await openChat(page);
  await pointAtSpot(page, post);
  await expect(chip(page)).toContainText('Point 2 in layer posts (IncidentMap)');
  const empty = await onMap(page, 8.65, 58.245);
  await pointAtSpot(page, empty);
  await expect(chip(page)).toContainText('<canvas> in IncidentMap');
});

test('while pointing, the label follows the pointer from feature to feature', async ({ page }) => {
  const area = await onMap(page, 8.595, 58.25);
  const post = await onMap(page, 8.635, 58.25);
  await openChat(page);
  await chat(page).getByRole('button', { name: 'Point at something' }).click();
  const label = page.locator('.label');
  await page.mouse.move(area.x, area.y);
  await expect(label).toHaveText(/^Polygon 1 in layer search-areas · <canvas>/);
  await page.mouse.move(post.x, post.y, { steps: 4 });
  await expect(label).toHaveText(/^Point 2 in layer posts · <canvas>/);
  await page.keyboard.press('Escape');
  await expect(hint(page)).toBeHidden();
});

test('a link to a map feature brings it back, and the ticket names it', async ({ page }) => {
  await onMap(page, 8.595, 58.25);
  const canvas = await idOf(page.getByTestId('map').locator('canvas'));
  await page.goto(`./canvas.html?klipp=${encodeURIComponent(`${canvas}@search-areas%3A1`)}`);
  await expect(chip(page)).toContainText('Polygon 1 in layer search-areas (IncidentMap)');
  await expect(replies(page).last()).toContainText('This is the thing from the link');

  await ask(page, 'please report this');
  const card = chat(page).locator('.card');
  await card.getByText('Page details added to it').click();
  const footer = card.locator('.card-footer');
  await expect(footer).toContainText('| Drawn | Polygon 1 in layer search-areas |');
  await expect(footer).toContainText(`\`${canvas}@search-areas%3A1\``);
  await card.getByRole('button', { name: 'Not now' }).click();
});

test('a react-three-fiber object leads to the JSX that made it', async ({ page }) => {
  const spot = await crate(page);
  await openChat(page);
  await pointAtSpot(page, spot);
  await expect(chip(page)).toContainText('Mesh "Crate" (Scene)');
  await ask(page, 'describe it');
  await expect(replies(page).last()).toContainText(
    /draws Mesh "Crate" \(type=Mesh, name=Crate, geometry=BoxGeometry, material=MeshStandardMaterial\); made at examples\/react-app\/src\/CanvasDemo\.tsx:\d+$/,
  );
});

test('elements inside a web component are pointed at and linked to', async ({ page }) => {
  const star = page.locator('star-rating').getByRole('button', { name: '2 stars' });
  await openChat(page);
  await pointAt(page, star);
  await expect(chip(page)).toContainText('<button> in CanvasDemo');
  const id = await idOf(star);
  expect(id).toMatch(/^[0-9a-z]{8}\.[0-9a-z]{4}\/s\/1\/1$/);
  expect(await star.evaluate((el, id) => window.klipp!.find(id) === el, id)).toBe(true);

  await page.goto(`./canvas.html?klipp=${encodeURIComponent(id)}`);
  await expect(chip(page)).toContainText('<button> in CanvasDemo');
  await ask(page, 'describe it');
  await expect(replies(page).last()).toContainText(/^button; states: none/);
});

test("the app's own JSX inside a shadow root keeps its stamped id", async ({ page }) => {
  const button = page.getByRole('button', { name: 'Inside a shadow root' });
  const id = await idOf(button);
  expect(id).toMatch(/^[0-9a-z]{8}\.[0-9a-z]{4}$/);
  expect(await button.evaluate((el, id) => window.klipp!.find(id) === el, id)).toBe(true);
  await openChat(page);
  await pointAt(page, button);
  await expect(chip(page)).toContainText('<button> in ShadowCard');
});
