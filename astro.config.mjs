// @ts-check
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { STALL_DRAW_SCRIPT } from './src/components/markets/stallDrawScript.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * CSP hash of a script Astro does not hash itself (an is:inline one).
 * @param {string} text
 */
const scriptHash = (text) => /** @type {`sha256-${string}`} */ (`sha256-${createHash('sha256').update(text).digest('base64')}`);

// https://astro.build/config
export default defineConfig({
  site: 'https://petsdrawings.com',
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    // Manual so /admin and /api stay reachable. Public pages live under /en and /es.
    routing: 'manual',
  },
  // A Content-Security-Policy header on every page (not in `astro dev`). Astro
  // hashes the scripts and <style> elements it renders. Stripe and PayPal need
  // nothing here: checkout leaves for them with location.assign(). Turnstile, when
  // its keys are set, loads from challenges.cloudflare.com. Images come from
  // Cloudinary, and data:/blob: are the photo pickers' previews. Templates use
  // style="" attributes, which cannot run script.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https://res.cloudinary.com",
        "font-src 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src 'self' https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Admin › Portada previews the home page in an iframe; nobody else may frame the site.
        "frame-ancestors 'self'",
      ],
      scriptDirective: {
        resources: ["'self'", 'https://challenges.cloudflare.com'],
        hashes: [scriptHash(STALL_DRAW_SCRIPT)],
      },
      styleDirective: {
        resources: [
          { resource: "'self'", kind: 'element' },
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
      },
    },
  },
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src'),
      },
    },
  },
});
