// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://petsdrawings.com',
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    // Manual so /admin and /api stay reachable. Public pages live under /en and /es.
    routing: 'manual',
  },
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src'),
      },
    },
  },
});
