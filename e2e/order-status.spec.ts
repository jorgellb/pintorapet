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

test('legal privacy page is final and names the controller', async ({ page }) => {
  await page.goto('/en/privacy/');
  await expect(page.locator('main')).toContainText('Data controller');
  await expect(page.locator('main')).toContainText('Meili Stringfellow');
  await expect(page.locator('main')).not.toContainText('Pending');
  await page.goto('/es/privacidad/');
  await expect(page.locator('main')).toContainText('Responsable del tratamiento');
  await expect(page.locator('main')).not.toContainText('Pendiente de revisión');
});
