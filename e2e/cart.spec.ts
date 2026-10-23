import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const catalog = JSON.parse(
  readFileSync(path.join(process.cwd(), 'migration/products.json'), 'utf8'),
) as { products: { id: string }[] };

const sampleId = catalog.products[0]?.id;

test.describe('cart persistence', () => {
  test.skip(!sampleId, 'migration/products.json missing products');

  test('seeded cart renders, persists, and removes lines', async ({ page }) => {
    await page.addInitScript(
      ({ key, productId }) => {
        if (sessionStorage.getItem('cart-seeded')) return;
        sessionStorage.setItem('cart-seeded', '1');
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            items: [{ productId, quantity: 2 }],
          }),
        );
      },
      { key: 'petsdrawings.cart.v1', productId: sampleId },
    );

    await page.goto('/en/cart/');
    const view = page.locator('[data-cart-view][data-variant="page"]');
    const line = view.locator('.cart-line[data-id]');
    await expect(line).toHaveCount(1);
    await expect(line.locator('output')).toHaveText('2');
    await expect(page.locator('[data-cart-count]')).toHaveText('2');

    await line.getByRole('button', { name: /Remove one/ }).click();
    await expect(line.locator('output')).toHaveText('1');
    await expect(page.locator('[data-cart-count]')).toHaveText('1');

    await page.reload();
    await expect(line).toHaveCount(1);
    await expect(line.locator('output')).toHaveText('1');

    await line.locator('[data-remove]').click();
    await expect(line).toHaveCount(0);
    await expect(page.locator('[data-cart-count]')).toHaveText('0');

    await view.getByRole('button', { name: 'Undo' }).click();
    await expect(line).toHaveCount(1);
    await expect(page.locator('[data-cart-count]')).toHaveText('1');
  });
});
