import { expect, test } from '@playwright/test';

const locales = [
  {
    code: 'en',
    home: '/en/',
    about: '/en/about-me/',
    work: '/en/work/',
    gallery: '/en/gallery/',
    commissions: '/en/commissions/',
    shop: '/en/shop/',
    contact: '/en/contact/',
    cart: '/en/cart/',
    otherLang: 'ES',
  },
  {
    code: 'es',
    home: '/es/',
    about: '/es/sobre-mi/',
    work: '/es/obra/',
    gallery: '/es/galeria/',
    commissions: '/es/encargos/',
    shop: '/es/tienda/',
    contact: '/es/contacto/',
    cart: '/es/carrito/',
    otherLang: 'EN',
  },
] as const;

for (const locale of locales) {
  test.describe(`public smoke (${locale.code})`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('home renders brand and primary nav', async ({ page }) => {
      await page.goto(locale.home);
      await expect(page.locator('header .brand')).toBeVisible();
      await expect(page.locator('header .brand__logo')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });

    test('language switch flips locale prefix', async ({ page }) => {
      await page.goto(locale.home);
      await page.locator('header .lang').click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale.code === 'en' ? 'es' : 'en'}/`),
      );
    });

    test('about shows interleaved studio images', async ({ page }) => {
      await page.goto(locale.about);
      await expect(page.locator('.about__figure img')).toHaveCount(4);
    });

    test('contact shows feedback screenshots', async ({ page }) => {
      await page.goto(locale.contact);
      await expect(page.locator('.feedback-grid img')).toHaveCount(3);
    });

    test('commissions shows photo/drawing example pairs', async ({ page }) => {
      await page.goto(locale.commissions);
      await expect(page.locator('.example')).toHaveCount(2);
      await expect(page.locator('.example img')).toHaveCount(4);
    });

    test('shop lists catalogue products', async ({ page }) => {
      await page.goto(locale.shop);
      const productLinks = page.locator(
        locale.code === 'en'
          ? 'a[href^="/en/shop/"][href$="/"]:not([href="/en/shop/"])'
          : 'a[href^="/es/tienda/"][href$="/"]:not([href="/es/tienda/"])',
      );
      await expect(productLinks.first()).toBeVisible();
      expect(await productLinks.count()).toBeGreaterThanOrEqual(1);
    });

    test('work and gallery pages load', async ({ page }) => {
      await page.goto(locale.work);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.goto(locale.gallery);
      await expect(page.locator('main h1').first()).toBeVisible();
    });

    test('cart page loads', async ({ page }) => {
      await page.goto(locale.cart);
      await expect(page.locator('main h1').first()).toBeVisible();
    });

    test('mobile menu opens and closes', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(locale.home);
      await page.locator('[data-menu-open]').click();
      await expect(page.locator('[data-mobile-menu]')).toBeVisible();
      await page.locator('[data-mobile-menu] button[value="close"]').click();
      await expect(page.locator('[data-mobile-menu]')).toBeHidden();
    });
  });
}
