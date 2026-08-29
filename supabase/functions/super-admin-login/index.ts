// POST /functions/v1/super-admin-login
//
// Username + password sign-in. Named for its original purpose, but it now serves
// any account that has been given a `profiles.username` — the super admin, and any
// test/demo account you deliberately enable. Accounts without a username (the
// default for everyone) cannot use this route at all and must use a magic link.
//
// The spec (§"Super Admin bootstrap") requires the super admin to sign in with a
// username instead of an email, without inventing a plaintext password table.
//
// So: the super admin IS an ordinary Supabase Auth user. This function is the
// server-side username -> auth-identity lookup. It resolves `nuwan` to that user's
// email, then performs a normal password sign-in with Supabase Auth and returns
// the resulting session. The password is verified by Supabase, never by us, and is
// never stored or logged here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json, serviceClient } from "../_shared/device.ts";

// Failed attempts per username, in-memory per isolate. A crude but useful brake on
// online guessing; real rate limiting belongs at the gateway.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!username || !password) return json({ error: "invalid_credentials" }, 400);
  if (rateLimited(username)) return json({ error: "too_many_attempts" }, 429);

  const admin = serviceClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("email, role, is_active, must_change_password")
    .eq("username", username)
    .maybeSingle();

  // Any role may sign in here, but ONLY if the account has been given a username.
  // `profiles.username` is null for everyone by default and is never set through
  // the app UI, so password login stays opt-in per account rather than being
  // silently available to every member (spec: ordinary accounts use magic links).
  //
  // Same response shape and status for "no such username" and "wrong password",
  // so the endpoint cannot be used to enumerate accounts.
  if (!profile || !profile.is_active) {
    return json({ error: "invalid_credentials" }, 401);
  }

  // Sign in with the anon key: this goes through Supabase Auth's own password
  // verification, so no password hashing is implemented in application code.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error || !data.session) return json({ error: "invalid_credentials" }, 401);

  attempts.delete(username);

  return json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    },
    // The client routes on this: staff land on /dashboard, members on /member.
    role: profile.role,
    must_change_password: profile.must_change_password,
  });
});
