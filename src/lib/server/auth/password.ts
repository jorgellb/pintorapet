/**
 * Password checks for Better Auth. New and changed passwords are its own
 * scrypt hashes; the bcrypt ones Supabase Auth had came over with the accounts
 * (scripts/aiven/copy_passwords.py) and are checked with pgcrypto's crypt(),
 * so nobody has to choose a new password because of the move.
 */
import { verifyPassword as verifyScrypt } from 'better-auth/crypto';
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
  return row?.ok === true;
}
