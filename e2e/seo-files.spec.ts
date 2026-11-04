import { expect, test } from '@playwright/test';

test('robots.txt points at the sitemap and keeps private pages out', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const body = await res.text();
  expect(body).toContain('Disallow: /admin/');
  expect(body).toMatch(/Sitemap: https:\/\/petsdrawings\.com\/sitemap\.xml/);
});

test('sitemap.xml lists the pages in both languages with their images', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/xml');
  const xml = await res.text();
  expect(xml).toContain('<loc>https://petsdrawings.com/es/tienda/</loc>');
  expect(xml).toContain('hreflang="en" href="https://petsdrawings.com/en/shop/"');
  expect(xml).toContain('<loc>https://petsdrawings.com/es/tienda/bola-de-navidad-pug/</loc>');
  expect(xml).toContain('<image:image>');
  expect(xml).not.toContain('/es/carrito/');
});
