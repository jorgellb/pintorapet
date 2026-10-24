import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BLOCK_SCORE,
  canonicalEmail,
  combine,
  emailSignal,
  leadingZeroBits,
  maskEmail,
  messageSignal,
  nameSignal,
} from '../src/lib/domain/antibot';

vi.mock('@/lib/server/supabase', () => ({ createServiceClient: () => null }));

describe('nameSignal', () => {
  it('flags the random strings bots paste as names', () => {
    expect(nameSignal('NmtFTuFNRIWVBYtXtRibtonr').reasons).toContain('name_random');
    expect(nameSignal('KjLrWLBxSzFpgIAmrxUYoO').reasons).toContain('name_random');
    expect(nameSignal('xkcdqwrtzpl').reasons).toContain('name_random');
  });

  it('leaves real names alone', () => {
    for (const name of [
      'Ana García',
      'María José Fernández-López',
      'Seán O’Connor',
      'Krzysztof Wojciechowski',
      'Schwarzschild',
      'Hirschsprung',
      'Brzęczyszczykiewicz',
      'Szczepański',
      'Ngozi Okonjo-Iweala',
      'MacKenzie',
      'DeAndre McDonald',
      'JOSÉ PÉREZ',
      'Nguyễn Thị Minh Khai',
      '李小龍',
      'Jean-Baptiste',
    ]) {
      const signal = nameSignal(name);
      expect(signal.reasons, name).not.toContain('name_random');
      expect(signal.points, name).toBeLessThan(BLOCK_SCORE / 2);
    }
  });

  it('flags links in the name field', () => {
    expect(nameSignal('Best deals www.cheap.example').reasons).toContain('name_link');
  });
});

describe('emailSignal', () => {
  it('sees the Gmail dot trick the two bots used', () => {
    expect(emailSignal('w.o.qusow.ica.6.17@gmail.com').reasons).toEqual(['email_dots', 'email_fragments']);
    expect(emailSignal('s.ibe.jefo.067@gmail.com').reasons).toEqual(['email_dots']);
  });

  it('accepts ordinary addresses', () => {
    expect(emailSignal('ana.garcia@gmail.com').points).toBe(0);
    expect(emailSignal('maria.jose.lopez@gmail.com').points).toBe(0);
    expect(emailSignal('a.b.c.d@empresa.es').points).toBe(0);
  });

  it('flags disposable inboxes', () => {
    expect(emailSignal('x@mailinator.com').reasons).toContain('email_disposable');
  });
});

describe('both bots from production', () => {
  it('score above the line on content alone', () => {
    const first = combine(nameSignal('NmtFTuFNRIWVBYtXtRibtonr'), emailSignal('w.o.qusow.ica.6.17@gmail.com'));
    const second = combine(nameSignal('KjLrWLBxSzFpgIAmrxUYoO'), emailSignal('s.ibe.jefo.067@gmail.com'));
    expect(first.points).toBeGreaterThanOrEqual(BLOCK_SCORE);
    expect(second.points).toBeGreaterThanOrEqual(BLOCK_SCORE);
  });
});

describe('messageSignal', () => {
  it('flags link farms and sales spam', () => {
    expect(messageSignal('[url=http://x.example]cheap[/url]').reasons).toContain('message_markup');
    expect(messageSignal('see https://a.example https://b.example https://c.example').reasons).toContain('message_links');
    expect(messageSignal('We offer SEO and backlinks for your site').points).toBeGreaterThanOrEqual(50);
  });

  it('leaves a commission request alone', () => {
    expect(
      messageSignal('Hola Meili, me gustaría un retrato de Luna, mi gata. Te mando fotos por email.').points,
    ).toBe(0);
  });
});

describe('emails', () => {
  it('counts Gmail spellings as one inbox', () => {
    expect(canonicalEmail('W.O.Qusow+promo@GoogleMail.com')).toBe('woqusow@gmail.com');
    expect(canonicalEmail('ana.garcia@empresa.es')).toBe('ana.garcia@empresa.es');
  });

  it('masks what the admin sees', () => {
    expect(maskEmail('w.o.qusow.ica.6.17@gmail.com')).toBe('w.o.***@gmail.com');
    expect(maskEmail('ab@x.es')).toBe('a***@x.es');
  });
});

describe('leadingZeroBits', () => {
  it('counts zero bits from the start', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x0f, 0xff]))).toBe(20);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });
});

describe('challenge and proof of work', async () => {
  const { issueChallenge, inspect, powValid, withoutAntibotFields } = await import('../src/lib/server/antibot');

  const solve = (nonce: string, difficulty: number) => {
    for (let counter = 0; ; counter += 1) {
      const digest = createHash('sha256').update(`${nonce}:${counter}`).digest();
      if (leadingZeroBits(digest) >= difficulty) return String(counter);
    }
  };

  const person = { k: 40, p: 3, w: false };

  it('lets a person through and stops replays of the parts', async () => {
    vi.useFakeTimers({ now: Date.now() });
    const challenge = await issueChallenge('register', '203.0.113.7');
    const counter = solve(challenge.nonce, challenge.difficulty);
    expect(powValid(challenge.nonce, counter, challenge.difficulty)).toBe(true);
    expect(powValid(challenge.nonce, `${counter}x`, challenge.difficulty)).toBe(false);

    const fields = { _ab_token: challenge.token, _ab_pow: counter, _ab_i: JSON.stringify(person), website: '' };
    const base = { form: 'register' as const, ip: '203.0.113.7', email: 'ana.garcia@gmail.com', name: 'Ana García' };

    expect((await inspect({ ...base, fields })).reasons).toContain('too_fast');

    vi.advanceTimersByTime(5000);
    expect(await inspect({ ...base, fields })).toEqual({ verdict: 'allow', score: 0, reasons: [] });
    expect((await inspect({ ...base, fields: { ...fields, website: 'http://x' } })).reasons).toEqual(['honeypot']);
    expect((await inspect({ ...base, fields: { ...fields, _ab_pow: '1' } })).verdict).toBe('block');
    expect((await inspect({ ...base, form: 'contact', fields })).reasons).toContain('token_form');
    expect((await inspect({ ...base, fields: { ...fields, _ab_token: challenge.token.slice(0, -2) + 'xx' } })).reasons).toEqual([
      'token_invalid',
    ]);

    // A bot that solves the challenge is still stopped by what it typed.
    const bot = await inspect({ ...base, fields, name: 'NmtFTuFNRIWVBYtXtRibtonr', email: 'w.o.qusow.ica.6.17@gmail.com' });
    expect(bot.verdict).toBe('block');

    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect((await inspect({ ...base, fields })).reasons).toEqual(['token_expired']);
    vi.useRealTimers();
  });

  it('stops forms sent without the challenge', async () => {
    const verdict = await inspect({ form: 'contact', fields: {}, ip: '203.0.113.7', email: 'a@b.es', name: 'Ana', message: 'Hola' });
    expect(verdict.verdict).toBe('block');
    expect(verdict.reasons).toContain('token_missing');
  });

  it('strips its own fields before strict schemas see them', () => {
    expect(withoutAntibotFields({ name: 'Ana', website: '', _ab_token: 't', _ab_pow: '1', _ab_i: '{}' })).toEqual({
      name: 'Ana',
    });
  });
});
