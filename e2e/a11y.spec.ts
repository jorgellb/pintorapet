import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  '/en/',
  '/en/about-me/',
  '/en/work/',
  '/en/gallery/',
  '/en/commissions/',
  '/en/shop/',
  '/en/contact/',
  '/en/cart/',
  '/en/account/sign-in/',
  '/en/account/register/',
  '/es/',
  '/es/sobre-mi/',
  '/es/obra/',
  '/es/galeria/',
  '/es/encargos/',
  '/es/tienda/',
  '/es/contacto/',
  '/es/carrito/',
  '/es/cuenta/entrar/',
  '/es/cuenta/recuperar/',
];

for (const path of pages) {
  test(`axe critical/serious: ${path}`, async ({ page }) => {
    // Scan the settled page: mid-way through an entrance animation a button is
    // half transparent and reads as low contrast. This is also how visitors who
    // ask for less motion see it.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact ?? ''),
    );

    expect(
      blocking,
      blocking
        .map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)
        .join('\n'),
    ).toEqual([]);
  });
}
