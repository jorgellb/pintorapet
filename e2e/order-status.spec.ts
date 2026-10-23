import { expect, test } from '@playwright/test';

test('order status form is noindex and accepts input', async ({ page }) => {
  await page.goto('/en/order-status/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(page.locator('[data-order-form]')).toBeVisible();
  await page.locator('[name="reference"]').fill('PD-TESTREF01');
  await page.locator('[name="accessToken"]').fill('x'.repeat(32));
  await page.locator('[data-order-form] button[type="submit"]').click();
  await expect(page.locator('[data-order-message]')).toBeVisible();
});

test('legal privacy page has reviewed-pending copy', async ({ page }) => {
  await page.goto('/en/privacy/');
  await expect(page.locator('main')).toContainText('Pending final owner review');
  await page.goto('/es/privacidad/');
  await expect(page.locator('main')).toContainText('Pendiente de revisión final');
});
