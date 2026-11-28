/**
 * Password checks for Better Auth. New and changed passwords are its own
 * scrypt hashes; the bcrypt ones Supabase Auth had came over with the accounts
 * (scripts/aiven/copy_passwords.py) and are checked with pgcrypto's crypt(),
 * so nobody has to choose a new password because of the move. The first time
 * one of those passwords is proved, it is stored again as scrypt.
 *
 * Supabase (Go's bcrypt) only ever wrote `$2a$` hashes. pgcrypto has no `$2b$`:
 * it reads that salt as an old DES one, so such a hash never matches here.
 */
import { hashPassword, verifyPassword as verifyScrypt } from 'better-auth/crypto';
import { db, type Db } from '@/lib/server/db';

const SUPABASE_HASH = /^\$2a\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isSupabaseHash(hash: string): boolean {
  return SUPABASE_HASH.test(hash);
}

export async function verifyPassword(
  { hash, password }: { hash: string; password: string },
  database: () => Db = db,
): Promise<boolean> {
  if (!isSupabaseHash(hash)) return verifyScrypt({ hash, password });
  const row = await database().one<{ ok: boolean }>`SELECT extensions.crypt(${password}, ${hash}) = ${hash} AS ok`;
  if (row?.ok !== true) return false;
  await upgradeHash(hash, password, database);
  return true;
}

/**
 * Replace a bcrypt hash that has just been proved with a scrypt hash of the same
 * password, so the plaintext stops going to PostgreSQL. The bcrypt hash has a
 * random salt, so it names one account. If this fails, the sign-in still goes
 * ahead and the next one tries again.
 */
async function upgradeHash(hash: string, password: string, database: () => Db): Promise<void> {
  try {
    const scrypt = await hashPassword(password);
    await database().run`
      UPDATE auth.account SET password = ${scrypt}, updated_at = now()
      WHERE provider_id = 'credential' AND password = ${hash}`;
  } catch (err) {
    console.error('[auth] could not upgrade a bcrypt password hash:', err instanceof Error ? err.message : err);
  }
}
