import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';
import { STALL_DRAW_SCRIPT } from '../src/components/markets/stallDrawScript.mjs';

const csp = config.security?.csp;
if (!csp || csp === true) throw new Error('security.csp is not configured');

function astroFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return astroFiles(full);
    return entry.name.endsWith('.astro') ? [full] : [];
  });
}

describe('Content-Security-Policy', () => {
  it('locks down what pages may load and where forms may post', () => {
    expect(csp.directives).toEqual(
      expect.arrayContaining([
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ]),
    );
  });

  it('never allows inline or eval scripts wholesale', () => {
    const scripts = (csp.scriptDirective?.resources ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.resource));
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it('allows the market stall script by its hash', () => {
    const hash = `sha256-${createHash('sha256').update(STALL_DRAW_SCRIPT).digest('base64')}`;
    expect(csp.scriptDirective?.hashes).toContain(hash);
  });

  // Astro hashes the scripts it processes. A <script> with attributes (is:inline,
  // define:vars, type=…) is left as it is and would be blocked, unless it is data.
  it('has no other inline script that would be blocked', () => {
    const offenders = astroFiles(path.resolve('src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<script\s[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => !/type="application\/(ld\+)?json"/.test(tag) && !tag.includes('set:html={STALL_DRAW_SCRIPT}'))
        .map((tag) => `${path.relative(process.cwd(), file)}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });
});
