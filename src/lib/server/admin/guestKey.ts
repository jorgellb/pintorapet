import { createHash } from 'node:crypto';

/** The key of a guest in the URL: what public.guest_key(email) computes, so the email is never in a link. */
export const GUEST_KEY = /^[0-9a-f]{64}$/;

/** lower(btrim(email)): btrim only takes off spaces, so this does the same (not every kind of whitespace). */
export function guestKey(email: string): string {
  return createHash('sha256').update(email.replace(/^ +| +$/g, '').toLowerCase()).digest('hex');
}
