/**
 * Smaller copies of our images. Cloudinary delivery URLs carry their size cap
 * (`c_limit,w_2000`, see server/media/cloudinary.ts); swapping it asks for a
 * lighter file, which thumbnails and grids want. Other URLs pass as they are.
 */
const CAP = '/c_limit,w_2000/';

const resizable = (url: string) => url.startsWith('https://res.cloudinary.com/') && url.includes(CAP);

export function sizedImage(url: string | null, width: number): string | null {
  if (!url || !resizable(url)) return url;
  return url.replace(CAP, `/c_limit,w_${Math.round(width)}/`);
}

/** Capped by height instead: for slots of a fixed height whose width follows the drawing. */
export function sizedImageByHeight(url: string, height: number): string {
  if (!resizable(url)) return url;
  return url.replace(CAP, `/c_limit,h_${Math.round(height)}/`);
}

/** Candidate widths for `srcset`, by how large the slot can get. */
export const WIDTHS = {
  thumb: [160, 240, 360, 480],
  card: [240, 360, 480, 720, 960],
  half: [360, 480, 720, 960, 1200, 1600],
  wide: [480, 720, 960, 1200, 1600, 2000],
} as const;

export type ImageAttrs = { src: string; srcset?: string; sizes?: string };

/**
 * `src`, `srcset` and `sizes` for an `<img>`: the browser picks the smallest
 * copy that fills the slot (`sizes`) at the screen's density. `src` is the
 * largest copy, for crawlers and old browsers. Images we cannot resize keep
 * their single `src`.
 */
export function responsiveImage(url: string, widths: readonly number[], sizes: string): ImageAttrs {
  if (!resizable(url) || widths.length === 0) return { src: url };
  return {
    src: sizedImage(url, widths[widths.length - 1]!)!,
    srcset: widths.map((w) => `${sizedImage(url, w)} ${w}w`).join(', '),
    sizes,
  };
}

/** For a slot of fixed height: `1x` and `2x` copies by height. */
export function fixedHeightImage(url: string, height: number): ImageAttrs {
  if (!resizable(url)) return { src: url };
  return {
    src: sizedImageByHeight(url, height),
    srcset: `${sizedImageByHeight(url, height)} 1x, ${sizedImageByHeight(url, height * 2)} 2x`,
  };
}

/** Link previews (Open Graph, X): 1200 × 630, the drawing whole on white, as JPEG. */
export const SHARE_SIZE = { width: 1200, height: 630 } as const;

export function shareImage(url: string): { url: string; width?: number; height?: number } {
  if (!resizable(url)) return { url };
  // Some apps that read previews do not show modern formats, so JPEG, not f_auto.
  const padded = url
    .replace(CAP, `/c_pad,w_${SHARE_SIZE.width},h_${SHARE_SIZE.height},b_white/`)
    .replace('/f_auto/', '/f_jpg/');
  return { url: padded, ...SHARE_SIZE };
}
