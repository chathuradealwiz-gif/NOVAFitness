#!/usr/bin/env node
/**
 * One-off bootstrap of the Super Admin account.
 *
 *   node scripts/bootstrap-super-admin.mjs
 *
 * Creates a real Supabase Auth user (so Supabase Auth does the password hashing
 * and verification — no plaintext password table anywhere) and marks its profile
 * role = super_admin with the login username.
 *
 * Reads SUPER_ADMIN_* and SUPABASE_SERVICE_ROLE_KEY from the environment. The
 * spec's development credential (nuwan / 1234) is deliberately NOT the default:
 * this script refuses to run with a weak password unless you pass --allow-weak
 * for local development.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Minimal .env.local loader so the script works without extra dependencies.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env.local — rely on the ambient environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const username = (process.env.SUPER_ADMIN_USERNAME ?? "nuwan").toLowerCase();
const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const allowWeak = process.argv.includes("--allow-weak");

if (!url || !serviceKey || !email || !password) {
  console.error(
    "Missing env. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
      "SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD",
  );
  process.exit(1);
}

if (password.length < 12 && !allowWeak) {
  console.error(
    `Refusing to create a super admin with a ${password.length}-character password.\n` +
      "Use a strong password, or pass --allow-weak for local development only.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Super Admin" },
});

let userId = created?.user?.id;

if (createError) {
  if (!/already/i.test(createError.message)) {
    console.error("Could not create the auth user:", createError.message);
    process.exit(1);
  }

  // Already exists — find it and reset the password to the configured one.
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

  if (!existing) {
    console.error("User reportedly exists but could not be found.");
    process.exit(1);
  }

  userId = existing.id;
  await supabase.auth.admin.updateUserById(userId, { password });
  console.log(`Existing auth user ${email} found; password reset.`);
}

// The on_auth_user_created trigger already inserted a profile row with role
// 'user'; promote it and attach the login username.
const { error: profileError } = await supabase
  .from("profiles")
  .update({
    role: "super_admin",
    username,
    full_name: "Super Admin",
    is_active: true,
    // Weak bootstrap passwords must be changed before production.
    must_change_password: password.length < 12,
  })
  .eq("user_id", userId);

if (profileError) {
  console.error("Could not promote the profile:", profileError.message);
  process.exit(1);
}

console.log(`\nSuper Admin ready.`);
console.log(`  username: ${username}`);
console.log(`  email:    ${email}`);
console.log(`\nSign in at /login via "Super Admin sign in".`);
if (password.length < 12) {
  console.log("\nWARNING: this is a development password. Change it before production.");
}
