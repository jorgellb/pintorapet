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
  '/es/',
  '/es/sobre-mi/',
  '/es/obra/',
  '/es/galeria/',
  '/es/encargos/',
  '/es/tienda/',
  '/es/contacto/',
  '/es/carrito/',
];

for (const path of pages) {
  test(`axe critical/serious: ${path}`, async ({ page }) => {
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
