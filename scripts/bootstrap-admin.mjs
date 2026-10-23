#!/usr/bin/env node
/**
 * Link an existing Supabase Auth user to admin_users by email.
 * Does NOT create passwords. User must already exist in Auth (invite/sign-up disabled for public).
 *
 * Usage:
 *   export PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export ADMIN_BOOTSTRAP_EMAIL=artist@example.com
 *   node scripts/bootstrap-admin.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();

if (!url || !key) {
  console.error('Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!email || !email.includes('@')) {
  console.error('Set ADMIN_BOOTSTRAP_EMAIL to a real address (no default password).');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 200,
});
if (listErr) {
  console.error(listErr.message);
  process.exit(1);
}

const user = listed.users.find((u) => (u.email || '').toLowerCase() === email);
if (!user) {
  console.error(
    `No Auth user with email ${email}. Create the user in Supabase Auth (invite) first, then re-run.`,
  );
  process.exit(1);
}

const { error } = await supabase.from('admin_users').upsert(
  {
    user_id: user.id,
    email,
    is_active: true,
    permissions: { role: 'admin' },
  },
  { onConflict: 'user_id' },
);

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`OK: ${email} → admin_users (${user.id})`);
