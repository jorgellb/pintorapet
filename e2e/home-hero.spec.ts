import { expect, test } from '@playwright/test';

/** The five home page designs (Admin › Portada), previewed with ?portada=. */
const designs = [
  { key: 'collage', root: 'section.hero' },
  { key: 'reveal', root: 'section.reveal' },
  { key: 'wall', root: 'section.wall' },
  { key: 'sketchbook', root: 'section.book' },
  { key: 'salon', root: 'section.salon' },
] as const;

for (const { key, root } of designs) {
  test(`home hero · ${key}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/es/?portada=${key}`);
    const hero = page.locator(root);
    await expect(hero).toBeVisible();
    await expect(hero.locator('h1')).toBeVisible();
    await expect(hero.locator('a.btn').first()).toHaveAttribute('href', /^\/es\//);
    // The main picture loads.
    const img = hero.locator('img').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // A preview is not a page of its own for search engines.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(errors).toEqual([]);
  });
}

test('the home page without a preview stays indexable', async ({ page }) => {
  await page.goto('/es/');
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
});

test('the reveal design can be compared with the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/?portada=reveal');
  const range = page.getByRole('slider', { name: 'Compare the photo and the drawing' });
  await range.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-reveal]')).toHaveAttribute('style', /--cut:\s*0%/);
});
