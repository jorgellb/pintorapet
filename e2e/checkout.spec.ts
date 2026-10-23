import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const catalog = JSON.parse(
  readFileSync(path.join(process.cwd(), 'migration/products.json'), 'utf8'),
) as { products: { id: string }[] };

const sampleId = catalog.products[0]?.id;

test.describe('checkout form', () => {
  test.skip(!sampleId, 'migration/products.json missing products');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ key, productId }) => {
        if (sessionStorage.getItem('checkout-seeded')) return;
        sessionStorage.setItem('checkout-seeded', '1');
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify({ version: 1, items: [{ productId, quantity: 1 }] }));
      },
      { key: 'petsdrawings.cart.v1', productId: sampleId },
    );
  });

  test('writes the parcel label, fills the province and suggests the email', async ({ page }) => {
    await page.goto('/es/finalizar-compra/');
    const form = page.locator('[data-checkout-form]');
    test.skip((await form.count()) === 0, 'no payment provider and not in development');

    await page.fill('#co-email', 'ana@gmial.com');
    await page.locator('#co-phone').focus();
    await expect(page.locator('[data-email-suggest]')).toContainText('ana@gmail.com');
    await page.locator('[data-email-suggest] button').click();
    await expect(page.locator('#co-email')).toHaveValue('ana@gmail.com');

    await page.fill('#co-name', 'Ana García');
    await page.fill('#co-postal', '46001');
    await page.fill('#co-line1', 'Calle de la Paz 14');
    await page.fill('#co-city', 'Valencia');

    await expect(page.locator('[data-label="name"]')).toHaveText('Ana García');
    await expect(page.locator('[data-label="city"]')).toHaveText('46001 Valencia');
    await expect(page.locator('#co-state')).toHaveValue('Valencia');

    await page.fill('#co-postal', '35001');
    await expect(page.locator('#co-state')).toHaveValue('Las Palmas');
  });

  test('marks missing fields when paying too early', async ({ page }) => {
    await page.goto('/en/checkout/');
    const pay = page.locator('[data-pay]').first();
    test.skip((await pay.count()) === 0, 'no payment provider and not in development');

    await pay.click();
    await expect(page.locator('[data-field="email"]')).toHaveClass(/is-invalid/);
    await expect(page.locator('[data-pay-status]')).toHaveClass(/is-error/);
  });

  test('has no critical accessibility issues', async ({ page }) => {
    await page.goto('/es/finalizar-compra/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test('an empty cart shows a way back to the shop instead of the form', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('petsdrawings.cart.v1'));
  await page.goto('/en/checkout/');
  const form = page.locator('[data-checkout-form]');
  test.skip((await form.count()) === 0, 'no payment provider and not in development');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('.co-step--contact')).toBeHidden();
  await expect(page.locator('[data-parcel]')).toBeHidden();
});
