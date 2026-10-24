/**
 * Content signals for the anti-bot gate: pure functions, no I/O. Each returns
 * points and the reason codes behind them; the server adds the points from
 * every signal and blocks at BLOCK_SCORE.
 */

export const BLOCK_SCORE = 70;

export type Signal = { points: number; reasons: string[] };

const none: Signal = { points: 0, reasons: [] };

/** Disposable inbox providers that bots and throwaway sign-ups lean on. */
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '20minutemail.com', 'anonaddy.me', 'byom.de', 'dispostable.com',
  'dropmail.me', 'emailondeck.com', 'fakeinbox.com', 'getairmail.com', 'getnada.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamailblock.com', 'harakirimail.com',
  'inboxkitten.com', 'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailnesia.com', 'mailpoof.com', 'mintemail.com', 'moakt.com', 'mohmal.com',
  'mytemp.email', 'sharklasers.com', 'spam4.me', 'spambox.us', 'temp-mail.io',
  'temp-mail.org', 'tempmail.com', 'tempmail.dev', 'tempmailo.com', 'tempr.email',
  'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'yopmail.com', 'yopmail.fr',
]);

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The same inbox whatever the spelling: Gmail ignores dots and "+tags", so
 * w.o.qusow@gmail.com and woqusow+x@gmail.com count as one for rate limits.
 */
export function canonicalEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/** "w.o.qusow.ica.6.17@gmail.com" → "w.o.***@gmail.com": enough to recognise, not to reuse. */
export function maskEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return value.slice(0, 3) + '***';
  return `${value.slice(0, Math.min(4, Math.max(1, at - 1)))}***${value.slice(at)}`.slice(0, 80);
}

/**
 * Names typed by people have spaces, vowels and capitals at the start of words.
 * Bots paste strings like "NmtFTuFNRIWVBYtXtRibtonr".
 */
export function nameSignal(name: string): Signal {
  const value = name.normalize('NFC').trim();
  if (!value) return none;
  const reasons: string[] = [];
  let points = 0;

  if (/https?:\/\/|www\.|\.(com|ru|xyz|top)\b/i.test(value)) {
    points += 70;
    reasons.push('name_link');
  }

  const words = value.split(/[\s'’\-.]+/).filter(Boolean);
  const random = words.some((word) => {
    const letters = word.replace(/[^\p{L}]/gu, '');
    if (letters.length < 8) return false;
    const inner = letters.slice(1);
    const innerUpper = (inner.match(/\p{Lu}/gu) ?? []).length;
    const lower = (letters.match(/\p{Ll}/gu) ?? []).length;
    let switches = 0;
    for (let i = 1; i < letters.length; i += 1) {
      const a = letters[i - 1] === letters[i - 1].toUpperCase();
      const b = letters[i] === letters[i].toUpperCase();
      if (a !== b) switches += 1;
    }
    // Mixed case inside the word (McDonald has one capital inside, not four).
    const mixed = lower >= 2 && innerUpper >= 3 && switches >= 4;
    // Latin words with (almost) no vowels or a run of consonants no language
    // uses: German names reach 7 ("Hirschsprung"), keyboard mashing goes past.
    const latin = /^[a-z]+$/i.test(letters);
    const vowels = latin ? (letters.match(/[aeiouy]/gi) ?? []).length / letters.length : 1;
    const consonantRun = latin && /[bcdfghjklmnpqrstvwxz]{8,}/i.test(letters);
    return mixed || (letters.length >= 10 && vowels < 0.1) || consonantRun;
  });
  if (random) {
    points += 60;
    reasons.push('name_random');
  }

  if (words.length === 1 && value.replace(/[^\p{L}]/gu, '').length >= 18) {
    points += 20;
    reasons.push('name_long');
  }

  return { points, reasons };
}

export function emailSignal(email: string): Signal {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return none;
  const local = value.slice(0, at).split('+')[0];
  const domain = value.slice(at + 1);
  const reasons: string[] = [];
  let points = 0;

  if (DISPOSABLE_DOMAINS.has(domain)) {
    points += 60;
    reasons.push('email_disposable');
  }

  // Gmail "dot trick": one inbox, endless addresses.
  if (GMAIL_DOMAINS.has(domain)) {
    const parts = local.split('.');
    const dots = parts.length - 1;
    if (dots >= 3) {
      points += 35;
      reasons.push('email_dots');
      if (parts.filter((part) => part.length === 1).length >= 2) {
        points += 15;
        reasons.push('email_fragments');
      }
    }
  }

  return { points, reasons };
}

const SPAM_WORDS =
  /\b(seo|backlinks?|crypto|bitcoin|casino|viagra|cialis|forex|loan|escort|porn|betting|web ?traffic|rank(ing)? (your|on) google)\b/gi;

/** For messages (contact, commissions): link farms and the usual sales spam. */
export function messageSignal(message: string): Signal {
  const value = message.trim();
  if (!value) return none;
  const reasons: string[] = [];
  let points = 0;

  const links = (value.match(/https?:\/\/|www\./gi) ?? []).length;
  if (/\[url=|<a\s+href=/i.test(value)) {
    points += 60;
    reasons.push('message_markup');
  }
  if (links >= 3) {
    points += 40;
    reasons.push('message_links');
  } else if (links >= 1 && value.length < 80) {
    points += 25;
    reasons.push('message_link_only');
  }

  const spam = new Set((value.match(SPAM_WORDS) ?? []).map((word) => word.toLowerCase()));
  if (spam.size > 0) {
    points += Math.min(60, spam.size * 25);
    reasons.push('message_spam_words');
  }

  return { points, reasons };
}

/** What the page measured while the visitor filled the form (all optional, all can lie). */
export type Interaction = {
  /** Trusted key presses and text input events */
  keys?: number;
  /** Trusted pointer and touch events */
  pointer?: number;
  /** navigator.webdriver: true in automated browsers */
  webdriver?: boolean;
};

export function interactionSignal(interaction: Interaction | null, { expectTyping }: { expectTyping: boolean }): Signal {
  if (!interaction) return { points: 30, reasons: ['no_signals'] };
  const reasons: string[] = [];
  let points = 0;
  if (interaction.webdriver) {
    points += 50;
    reasons.push('webdriver');
  }
  const keys = interaction.keys ?? 0;
  const pointer = interaction.pointer ?? 0;
  if (expectTyping && keys === 0 && pointer === 0) {
    points += 30;
    reasons.push('no_interaction');
  }
  return { points, reasons };
}

export function combine(...signals: Signal[]): Signal {
  return signals.reduce<Signal>(
    (acc, signal) => ({ points: acc.points + signal.points, reasons: [...acc.reasons, ...signal.reasons] }),
    { points: 0, reasons: [] },
  );
}

/** Leading zero bits of a hash: the proof of work the browser has to find. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}
