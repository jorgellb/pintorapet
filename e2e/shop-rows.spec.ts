import { expect, test } from '@playwright/test';

/** The shop, arranged by shop category (Admin › Tienda › Categorías), one sliding row each. */

const setNamed = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.set', { has: page.locator('.set__name', { hasText: new RegExp(`^${name}$`) }) });

test('every category has its row, with the new portraits', async ({ page }) => {
  await page.goto('/es/tienda/');
  const names = await page.locator('.set__name').allInnerTexts();
  for (const name of ['Cockapoo', 'Bulldog francés', 'Pug']) expect(names).toContain(name);
  // Card, coaster, mug and Christmas ornament, in that order (more may follow).
  const kinds = await setNamed(page, 'Bulldog francés').locator('.item__title').allInnerTexts();
  expect(kinds.slice(0, 4)).toEqual(['Tarjeta', 'Posavasos', 'Taza', 'Bola de Navidad']);
  await expect(page.locator('.medallion__name', { hasText: 'Pug' })).toBeVisible();

  await page.goto('/en/shop/');
  await expect(setNamed(page, 'French Bulldog')).toBeVisible();
});

test('a row slides right with its arrows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // No smooth scrolling: each arrow lands at once, so the test never races the animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/es/tienda/');
  const set = setNamed(page, 'Pug');
  const row = set.locator('[data-row]');
  const prev = set.getByRole('button', { name: 'Anteriores de Pug' });
  const next = set.getByRole('button', { name: 'Más de Pug' });
  await set.scrollIntoViewIfNeeded();
  await expect(next).toBeEnabled();
  await expect(prev).toBeDisabled();
  await expect(row).toHaveClass(/has-more-end/);

  await next.click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(prev).toBeEnabled();

  // However many pieces the row has, the arrow walks it to the end…
  // The row's own position decides; the arrows' state follows a scroll event later.
  const atEnd = () => row.evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  const atStart = () => row.evaluate((el) => el.scrollLeft <= 4);
  for (let step = 0; step < 12 && !(await atEnd()); step += 1) {
    const from = await row.evaluate((el) => el.scrollLeft);
    await next.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(from);
  }
  await expect(next).toBeDisabled();
  await expect(row).not.toHaveClass(/has-more-end/);

  // …and back to the start.
  for (let step = 0; step < 12 && !(await atStart()); step += 1) {
    const from = await row.evaluate((el) => el.scrollLeft);
    await prev.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeLessThan(from);
  }
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeLessThan(5);
  await expect(prev).toBeDisabled();
});

test('choosing a portrait shows only its row', async ({ page }) => {
  await page.goto('/es/tienda/?breed=cockapoo');
  await expect(page.locator('.set')).toHaveCount(1);
  await expect(page.locator('.set__name')).toHaveText('Cockapoo');
});

test('choosing a type shows all its pieces together, named by portrait', async ({ page }) => {
  await page.goto('/es/tienda/?category=mugs');
  // No rows by portrait: one grid with every mug.
  await expect(page.locator('.set')).toHaveCount(0);
  const grid = page.locator('[data-kind-grid]');
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Tazas');
  const titles = await grid.locator('.item__title').allInnerTexts();
  expect(titles.length).toBeGreaterThan(3);
  for (const name of ['Cockapoo', 'Bulldog francés', 'Pug']) expect(titles).toContain(name);
  // Every tag on the grid says mug.
  const kinds = await grid.locator('.tag__kind').allTextContents();
  expect(new Set(kinds)).toEqual(new Set(['Taza']));
  await expect(page.locator('.kind.is-active')).toHaveText('Tazas');

  // "All" keeps the rows by portrait.
  await page.locator('.kind', { hasText: 'Todos' }).click();
  await expect(page.locator('[data-kind-grid]')).toHaveCount(0);
  await expect(page.locator('.set').first()).toBeVisible();
});

test('a type and a portrait together show just that piece', async ({ page }) => {
  await page.goto('/en/shop/?category=keyrings&breed=pug');
  const grid = page.locator('[data-kind-grid]');
  await expect(grid.locator('.item__title')).toHaveText(['Pug']);
});
