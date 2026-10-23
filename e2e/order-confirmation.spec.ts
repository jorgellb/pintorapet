import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const order = (paymentStatus: string) => ({
  reference: 'PD-26-0042',
  paymentStatus,
  customerEmail: 'ana@example.com',
  customerName: 'Ana García',
  shipping: { zoneName: 'Península' },
  totals: { subtotalCents: 999, shippingCents: 590, totalCents: 1589 },
  items: [{ title: 'Jack Russell Terrier Mug', quantity: 1, lineTotalCents: 999 }],
});

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('confirm-seeded')) return;
    sessionStorage.setItem('confirm-seeded', '1');
    sessionStorage.setItem(
      'petsdrawings.orderAccess.v1',
      JSON.stringify({ reference: 'PD-26-0042', accessToken: 'x'.repeat(32) }),
    );
    localStorage.setItem('petsdrawings.checkout.v1', JSON.stringify({ city: 'Valencia', note: 'Ring 3B' }));
    localStorage.setItem('petsdrawings.destination.v1', JSON.stringify({ country: 'ES', postalCode: '46001' }));
    localStorage.setItem(
      'petsdrawings.cart.v1',
      JSON.stringify({ version: 1, items: [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] }),
    );
  });
}

test.describe('order confirmation', () => {
  test('waits for the payment, then thanks the customer and empties the cart', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/orders/lookup/', (route) => {
      calls += 1;
      return route.fulfill({ json: order(calls > 1 ? 'paid' : 'processing') });
    });
    await seed(page);
    await page.goto('/en/checkout/success/?session_id=cs_test');

    const root = page.locator('[data-confirm]');
    await expect(root).toHaveAttribute('data-state', 'pending');
    await expect(root).toHaveAttribute('data-state', 'paid', { timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Thank you, Ana!');
    await expect(page.locator('[data-receipt="total"]')).toHaveText('€15.89');
    await expect(page.locator('[data-home-city]')).toHaveText('Valencia');
    await expect(page.locator('[data-status-link]')).toHaveAttribute('href', /ref=PD-26-0042/);

    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('petsdrawings.cart.v1') || '{}'));
    expect(cart.items).toEqual([]);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petsdrawings.checkout.v1') || '{}'));
    expect(saved.note).toBeUndefined();
    expect(saved.city).toBe('Valencia');
  });

  test('says so when the payment did not go through and keeps the cart', async ({ page }) => {
    await page.route('**/api/orders/lookup/', (route) => route.fulfill({ json: order('expired') }));
    await seed(page);
    await page.goto('/es/compra/confirmacion/');

    await expect(page.locator('[data-confirm]')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByRole('link', { name: 'Volver al carrito' })).toBeVisible();
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('petsdrawings.cart.v1') || '{}'));
    expect(cart.items).toHaveLength(1);
  });

  test('without the order details it explains what happens next', async ({ page }) => {
    await page.goto('/es/compra/confirmacion/?ref=PD-26-0042');
    await expect(page.locator('[data-confirm]')).toHaveAttribute('data-state', 'unknown');
    await expect(page.locator('.done__eyebrow')).toContainText('PD-26-0042');
  });

  test('has no critical accessibility issues', async ({ page }) => {
    await page.route('**/api/orders/lookup/', (route) => route.fulfill({ json: order('paid') }));
    await seed(page);
    await page.goto('/es/compra/confirmacion/');
    await expect(page.locator('[data-confirm]')).toHaveAttribute('data-state', 'paid');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
