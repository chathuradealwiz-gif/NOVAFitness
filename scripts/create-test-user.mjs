#!/usr/bin/env node
/**
 * Creates a test login for the MEMBER view and prints a ready-to-use sign-in link.
 *
 *   node scripts/create-test-user.mjs 34
 *   node scripts/create-test-user.mjs 34 pasan@nova.test 000000
 *
 * Why the link: members sign in by magic link, and Supabase rate-limits the
 * outgoing email. `auth.admin.generateLink` mints the same link server-side
 * WITHOUT sending any email, so it never touches that limit. Paste the printed URL
 * into the browser and you are signed in as that member.
 *
 * It also sets a password on the account. Note the app's member UI is magic-link
 * only, so the password is not usable for signing in today — the link is. The
 * password is set so the account is ready if password login is ever enabled.
 *
 * LOCAL TESTING ONLY. Uses the service-role key. Delete the user when done:
 *   node scripts/create-test-user.mjs 34 --remove
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  /* fall back to the ambient environment */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const positional = args.filter((a) => !a.startsWith("--"));
const [number, loginNameArg, passwordArg, emailArg] = positional;

if (!number) {
  console.error(
    "Usage: node scripts/create-test-user.mjs <member-number> [username] [password] [email]",
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: member } = await db
  .from("members")
  .select("id, membership_id, full_name, email, status, user_id")
  .eq("membership_id", number)
  .maybeSingle();

if (!member) {
  console.error(`No member with number ${number}.`);
  process.exit(1);
}

// Username is what you type into the login form; email is only the underlying
// Supabase Auth identity and is never shown at sign-in.
const loginName = (loginNameArg || `member${number}`).toLowerCase();
const password = passwordArg || "000000";
const email = (emailArg || `${loginName}@nova.test`).toLowerCase();

// Find any existing auth user for this address.
async function findUser(address) {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === address) ?? null;
}

// ---------------------------------------------------------------- teardown

if (remove) {
  // Resolve via the member link first, so `--remove` works with only the member
  // number even when the username or email was customised at creation.
  let userId = member.user_id;

  if (!userId) {
    const byEmail = await findUser(email);
    userId = byEmail?.id ?? null;
  }

  if (userId) {
    await db.from("members").update({ user_id: null }).eq("user_id", userId);
    await db.auth.admin.deleteUser(userId);
    console.log(`Deleted the test login linked to member No. ${number}.`);
  } else {
    console.log(`No test login linked to member No. ${number}.`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- create

console.log(`Test login for No. ${member.membership_id} — ${member.full_name}`);

let user = await findUser(email);

if (user) {
  const { error } = await db.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.error(`\nCould not set the password: ${error.message}`);
    console.error("Supabase enforces a minimum password length (6 by default).");
    process.exit(1);
  }
  console.log(`  ✓ existing account ${email} updated`);
} else {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: member.full_name },
  });

  if (error) {
    console.error(`\nCould not create the account: ${error.message}`);
    if (/password/i.test(error.message)) {
      console.error("Supabase enforces a minimum password length (6 by default).");
      console.error("Try: node scripts/create-test-user.mjs " + number + " " + email + " 000000");
    }
    process.exit(1);
  }
  user = data.user;
  console.log(`  ✓ created ${email}`);
}

// The account must be role `user` and active, or the app redirects it away from
// the member view.
//
// Setting `username` is what enables the username + password form on /login for
// this account. Ordinary members have no username and can only use magic links,
// so password sign-in stays opt-in per account.
const { error: profileError } = await db
  .from("profiles")
  .update({
    role: "user",
    is_active: true,
    full_name: member.full_name,
    username: loginName,
  })
  .eq("user_id", user.id);

if (profileError) {
  console.error(`  ! could not set the username: ${profileError.message}`);
  if (profileError.code === "23505") {
    console.error(`    "${loginName}" is already taken by another account.`);
  }
  process.exit(1);
}
console.log(`  ✓ username "${loginName}" enabled for password sign-in`);

// Link the auth identity to this member record, clearing any other claim first.
await db.from("members").update({ user_id: null }).eq("user_id", user.id);
const { error: linkError } = await db
  .from("members")
  .update({ user_id: user.id })
  .eq("id", member.id);

if (linkError) {
  console.error(`  ! could not link member: ${linkError.message}`);
  process.exit(1);
}
console.log(`  ✓ linked to member No. ${member.membership_id}`);

// ---------------------------------------------------------------- sign-in link
//
// Generated, not emailed — this is what sidesteps the email rate limit.

const { data: link, error: linkErr } = await db.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `${siteUrl}/auth/callback` },
});

if (linkErr) {
  console.error(`  ! could not generate a sign-in link: ${linkErr.message}`);
  process.exit(1);
}

console.log("\n" + "─".repeat(70));
console.log('On /login choose "Sign in with username" and enter:\n');
console.log(`   username:  ${loginName}`);
console.log(`   password:  ${password}`);
console.log(`\n   -> lands on the member view for No. ${member.membership_id} (${member.status})`);
console.log("\n" + "─".repeat(70));
console.log("Or use this one-click sign-in link (no email sent, no rate limit):\n");
console.log(link.properties.action_link);
console.log("\n" + "─".repeat(70));
console.log(`auth email: ${email}   (internal only — never typed at sign-in)`);
console.log(`\nRemove the test login with: node scripts/create-test-user.mjs ${number} --remove`);
