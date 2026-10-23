export type CommerceErrorCode =
  | 'NOT_CONFIGURED'
  | 'VALIDATION'
  | 'PRICE_CHANGED'
  | 'UNAVAILABLE'
  | 'CONFLICT'
  | 'FORBIDDEN'
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

export function jsonError(err: CommerceError): Response {
  return Response.json(
    { error: { code: err.code, message: err.message, details: err.details } },
    { status: err.status },
  );
}
