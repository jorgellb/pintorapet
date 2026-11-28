// StallSketch.astro inlines this script, and astro.config.mjs hashes the same
// text for the Content-Security-Policy, so the two can never drift apart.
// Armed before the first paint, so the stall is not seen drawn and then wiped.
export const STALL_DRAW_SCRIPT =
  "if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('js-draw');";
