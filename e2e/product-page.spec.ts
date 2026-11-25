import { expect, test } from '@playwright/test';

/** A product page: its photos, the larger view, its options and what search engines read. */

test('tells search engines the product, its price and the way to it', async ({ page }) => {
  await page.goto('/es/tienda/taza-pug/');
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '[]');
  expect(data[0]).toMatchObject({ '@type': 'Product', brand: { name: 'Pets Drawings' }, offers: { priceCurrency: 'EUR' } });
  expect(data[1]['@type']).toBe('BreadcrumbList');
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'product');
  await expect(page.locator('.crumbs')).toContainText('Pug');
  await expect(page.locator('.details')).toContainText('325 ml');
});

test('the photos change with the thumbnails and open larger', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/es/tienda/posavasos-pug/');
  const thumbs = page.locator('[data-thumb]');
  expect(await thumbs.count()).toBeGreaterThan(1);
  await thumbs.nth(1).click();
  await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-count]')).toHaveText('2');

  await page.locator('[data-zoom="1"]').click();
  const dialog = page.locator('[data-zoom-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute('src', /pug-coasters-2/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('choosing an option shows its page', async ({ page }) => {
  await page.goto('/en/shop/pug-keyring/');
  await page.getByText('Rectangular', { exact: true }).click();
  await expect(page).toHaveURL(/rectangular/);
});

test('the pieces with the same portrait are offered below', async ({ page }) => {
  await page.goto('/es/tienda/taza-pug/');
  const more = page.locator('.more');
  await expect(more.getByRole('heading', { level: 2 })).toHaveText('Más con el retrato Pug');
  const kinds = await more.locator('.item__title').allInnerTexts();
  expect(kinds).toContain('Posavasos');
  expect(kinds).not.toContain('Taza');
});

test('a question on WhatsApp names the piece on show', async ({ page }) => {
  await page.goto('/es/tienda/llavero-pug/');
  const ask = page.locator('[data-ask]');
  await expect(ask).toHaveAttribute('href', /^https:\/\/wa\.me\/34636386531\?text=/);
  await expect(ask).toHaveAttribute('target', '_blank');
  const text = async () => new URL((await ask.getAttribute('href')) ?? '').searchParams.get('text');
  expect(await text()).toContain('«Llavero Pug» (PD-2068)');
  await page.getByText('Rectangular', { exact: true }).click();
  expect(await text()).toContain('Rectangular');
});
