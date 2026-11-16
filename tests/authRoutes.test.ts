import { describe, expect, it } from 'vitest';
import { isEmailLinkRoute } from '../src/lib/server/auth/routes';

describe('isEmailLinkRoute', () => {
  it('lets through only the links Better Auth puts in its emails', () => {
    expect(isEmailLinkRoute('GET', '/api/session/verify-email/')).toBe(true);
    expect(isEmailLinkRoute('GET', '/api/session/verify-email')).toBe(true);
    expect(isEmailLinkRoute('GET', '/api/session/reset-password/AbC_123-x/')).toBe(true);
    expect(isEmailLinkRoute('GET', '/api/session/magic-link/verify/')).toBe(true);
  });

  it('keeps sign-up, sign-in and every other endpoint behind our own forms', () => {
    expect(isEmailLinkRoute('POST', '/api/session/sign-up/email/')).toBe(false);
    expect(isEmailLinkRoute('POST', '/api/session/sign-in/email/')).toBe(false);
    expect(isEmailLinkRoute('POST', '/api/session/request-password-reset/')).toBe(false);
    expect(isEmailLinkRoute('POST', '/api/session/sign-in/magic-link/')).toBe(false);
    expect(isEmailLinkRoute('GET', '/api/session/get-session/')).toBe(false);
    expect(isEmailLinkRoute('POST', '/api/session/verify-email/')).toBe(false);
    expect(isEmailLinkRoute('GET', '/api/session/reset-password/a/b/')).toBe(false);
  });
});
