/**
 * A smaller copy of a catalogue image. Cloudinary delivery URLs carry their
 * size cap (`c_limit,w_2000`, see server/media/cloudinary.ts); swapping it asks
 * for a lighter file, which thumbnails and grids want. Other URLs pass as they are.
 */
export function sizedImage(url: string | null, width: number): string | null {
  if (!url) return url;
  if (!url.startsWith('https://res.cloudinary.com/')) return url;
  return url.replace('/c_limit,w_2000/', `/c_limit,w_${Math.round(width)}/`);
}
