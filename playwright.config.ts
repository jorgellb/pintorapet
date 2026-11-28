import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4323);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The DATABASE_URL that `astro dev` will use: the shell wins, then the same
 * .env files Vite reads in development, most specific first.
 */
function devDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.development.local', '.env.development', '.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
    if (value) return value;
  }
  return undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// The specs post forms and write rows, so they must never reach a real database.
const databaseUrl = devDatabaseUrl();
if (!LOOPBACK.has(hostOf(databaseUrl ?? ''))) {
  throw new Error(
    `E2E refused: DATABASE_URL ${databaseUrl ? 'points to a remote host' : 'is not set'}; it must point to localhost or 127.0.0.1. ` +
      'Start a local database (scripts/aiven/local-db.sh) and run with DATABASE_URL set to it.',
  );
}
if (!LOOPBACK.has(hostOf(baseURL))) {
  throw new Error(`E2E refused: PLAYWRIGHT_BASE_URL must be a local server (got "${baseURL}").`);
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally the tests run against `astro dev`, which compiles each page on its
  // first request: more browsers than this only queue up behind it and time out.
  workers: process.env.CI ? 1 : 4,
  reporter: [['list']],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // @astrojs/vercel does not support `astro preview`; use the dev server for local e2e.
  // Never reuse a server that is already running: its database is unknown.
  // With PLAYWRIGHT_BASE_URL, that server must use the DATABASE_URL checked above.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `env ASTRO_TELEMETRY_DISABLED=1 pnpm exec astro dev --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
