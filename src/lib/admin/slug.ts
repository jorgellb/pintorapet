/** URL-safe slug: lowercase ASCII words joined by hyphens. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function variantTitle(parentTitle: string, label: string): string {
  return label.trim() ? `${parentTitle} · ${label.trim()}` : parentTitle;
}
