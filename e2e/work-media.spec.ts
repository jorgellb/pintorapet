import { expect, test } from '@playwright/test';

test.describe('work media', () => {
  test('work index category filter is shareable', async ({ page }) => {
    await page.goto('/en/work/?category=dog');
    await expect(page.locator('.chip--active')).toHaveText('Dogs');
    await expect(page.locator('.grid li').first()).toBeVisible();
  });

  test('photo/drawing comparator and lightbox on Frankie', async ({ page }) => {
    await page.goto('/en/work/frankie/');
    await expect(page.locator('[data-compare]')).toBeVisible();
    const range = page.locator('[data-compare-range]');
    await range.fill('25');
    await expect(range).toHaveAttribute('aria-valuenow', '25');

    await page.getByRole('button', { name: /View larger: Drawing/i }).click();
    await expect(page.locator('[data-lightbox]')).toBeVisible();
    await page.locator('[data-lightbox] button[value="close"]').click();
    await expect(page.locator('[data-lightbox]')).toBeHidden();
  });

  test('gallery piece opens its sheet and the drawing can be enlarged', async ({ page }) => {
    await page.goto('/en/gallery/');
    await page.locator('.grid a').first().click();
    await expect(page).toHaveURL(/\/gallery\/.+/);
    await expect(page.locator('h1')).toBeVisible();
    await page.getByRole('button', { name: /View larger/i }).click();
    await expect(page.locator('[data-lightbox]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lightbox]')).toBeHidden();
  });
});
