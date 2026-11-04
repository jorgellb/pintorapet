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
  await expect(next).toBeDisabled();

  await prev.click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeLessThan(5);
});

test('choosing a portrait shows only its row', async ({ page }) => {
  await page.goto('/es/tienda/?breed=cockapoo');
  await expect(page.locator('.set')).toHaveCount(1);
  await expect(page.locator('.set__name')).toHaveText('Cockapoo');
});
