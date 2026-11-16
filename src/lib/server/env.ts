export function hasResend(): boolean {
  return Boolean(import.meta.env.RESEND_API_KEY);
}

export function siteUrl(): string {
  return (
    import.meta.env.SITE_URL ||
    import.meta.env.PUBLIC_SITE_URL ||
    'http://localhost:4321'
  ).replace(/\/$/, '');
}

export function emailFrom(): string {
  return (
    import.meta.env.EMAIL_FROM || 'Pets Drawings <orders@petsdrawings.com>'
  );
}

export function emailAdmin(): string {
  return import.meta.env.EMAIL_ADMIN || 'info@petsdrawings.com';
}
