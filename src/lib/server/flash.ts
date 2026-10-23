import type { AstroCookies } from 'astro';

/** A message carried across one redirect, so emails never travel in the URL. */
export type Flash = {
  error?: string;
  sent?: 'register' | 'forgot';
  email?: string;
  fullName?: string;
  /** A form as typed, to show it again after an error. */
  draft?: string;
};

const NAME = 'pd_flash';

export function setFlash(cookies: AstroCookies, flash: Flash): void {
  cookies.set(NAME, JSON.stringify(flash), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: 120,
  });
}

/** Read once and forget. */
export function takeFlash(cookies: AstroCookies): Flash | null {
  const raw = cookies.get(NAME)?.value;
  if (!raw) return null;
  cookies.delete(NAME, { path: '/' });
  try {
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}
