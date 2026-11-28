export type CommerceErrorCode =
  | 'NOT_CONFIGURED'
  | 'VALIDATION'
  | 'PRICE_CHANGED'
  | 'UNAVAILABLE'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class CommerceError extends Error {
  constructor(
    readonly code: CommerceErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

/**
 * What the browser gets: the code and the message. `details` stays on the
 * server (PostgreSQL's text, validation trees, causes), except the coupon
 * sentence the checkout shows.
 */
function respond(err: CommerceError): Response {
  const couponMessage = (err.details as { couponMessage?: unknown } | null | undefined)?.couponMessage;
  const details = typeof couponMessage === 'string' ? { details: { couponMessage } } : {};
  return Response.json({ error: { code: err.code, message: err.message, ...details } }, { status: err.status });
}

/** The answer for a CommerceError. A server error is logged with its detail first. */
export function jsonError(err: CommerceError): Response {
  if (err.status >= 500) console.error('[api] %s: %s', err.code, err.message, err.details ?? '');
  return respond(err);
}

/** The answer for an error nobody planned for: logged in full, answered with a plain 500. */
export function internalError(cause: unknown, message: string): Response {
  console.error('[api] %s', message, cause);
  return respond(new CommerceError('INTERNAL', message, 500));
}
