import { describe, expect, it } from 'vitest';
import { renderAuthEmail } from '../src/lib/server/auth/emails';

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
