import { describe, expect, it } from 'vitest';
import { renderAuthEmail, withTrailingSlash } from '../src/lib/server/auth/emails';

const url = 'https://petsdrawings.com/api/session/verify-email?token=t';

describe('renderAuthEmail', () => {
  it('writes each email in the visitor language with the link', () => {
    const es = renderAuthEmail('verify', 'es', { url, name: 'Luna' });
    expect(es.subject).toMatch(/Confirma/);
    expect(es.text).toContain('Hola, Luna');
    expect(es.text).toContain(url);

    const en = renderAuthEmail('reset', 'en', { url, name: '' });
    expect(en.subject).toMatch(/password/i);
    expect(en.text).toContain('Hello,');
    expect(en.text).toContain(url);
  });

  it('has a sign-in link email for the studio', () => {
    const mail = renderAuthEmail('magic', 'es', { url, name: '' });
    expect(mail.subject).toMatch(/Entrar/);
    expect(mail.text).toContain(url);
  });
});

describe('withTrailingSlash', () => {
  it('adds the slash this site uses to Better Auth links, before the query', () => {
    expect(withTrailingSlash('https://petsdrawings.com/api/session/verify-email?token=a&callbackURL=%2Fes%2Fcuenta%2F')).toBe(
      'https://petsdrawings.com/api/session/verify-email/?token=a&callbackURL=%2Fes%2Fcuenta%2F',
    );
    expect(withTrailingSlash('https://petsdrawings.com/api/session/reset-password/tok123?callbackURL=%2Fes%2F')).toBe(
      'https://petsdrawings.com/api/session/reset-password/tok123/?callbackURL=%2Fes%2F',
    );
  });

  it('leaves links that already have it, or are not URLs, alone', () => {
    expect(withTrailingSlash('https://petsdrawings.com/a/?x=1')).toBe('https://petsdrawings.com/a/?x=1');
    expect(withTrailingSlash('not a url')).toBe('not a url');
  });
});
