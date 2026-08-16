# NOVA FITNESS — Security Checklist

## Secrets

- [x] No credential is hard-coded in the frontend, firmware or repository.
- [x] The service-role key is used only by local bootstrap scripts and by Edge
      Functions (where Supabase injects it). It is **not** set in Vercel.
- [x] `.env.local`, `.env*.local` and `device-keys.txt` are git-ignored.
- [x] Device keys are stored only as SHA-256 hashes; the plaintext key is printed
      once at provisioning and lives in the device's NVS.
- [x] The super admin password is verified by Supabase Auth — no custom password
      hashing, no plaintext password table, never returned by any API.
- [ ] **Before production:** strong super-admin password, MFA enabled, all
      development credentials rotated.

## Authorisation

Enforced in three places, as the spec requires. Frontend guards are convenience
only; removing them would not grant access to anything.

1. **UI** — `middleware.ts` routes by role; `requireStaff` / `requireSuperAdmin` /
   `requireMember` guard every page.
2. **Server actions** — every mutation calls a role guard before touching data.
3. **Postgres RLS** — enabled on every table.

Specific properties worth re-testing after any schema change:

- [x] A member can read only their own member row, payments, attendance and plans.
- [x] A member cannot promote themselves — the `profiles` self-update policy pins
      `role` to its current value.
- [x] A member cannot change their own membership status, membership ID or
      fingerprint mapping. There is deliberately **no** member UPDATE policy on
      `members`, because RLS cannot restrict which columns a statement writes;
      self-service edits go through `update_own_member_profile()`, which writes only
      name, phone, emergency contact, address and avatar.
- [x] Only a super admin can create or modify admin accounts, or void/refund a
      payment.
- [x] A super admin cannot demote or disable their own account (lock-out guard).
- [x] `payments` has no DELETE policy; amount/type/date/member are immutable by
      trigger.
- [x] Audit rows are written by `SECURITY DEFINER` triggers, with no client INSERT
      policy, so they cannot be forged from the browser.
- [x] Helper functions used inside policies (`is_staff`, `current_member_id`) are
      `SECURITY DEFINER` with a pinned `search_path`, so policies cannot recurse or
      be hijacked by a search-path attack.

## Device security

- [x] Devices authenticate per-device; there is no shared secret across terminals.
- [x] Key comparison is constant time.
- [x] Disabled devices are rejected even with a valid key.
- [x] Attendance is idempotent on `event_id`, so a replayed queue cannot inflate
      records.
- [x] The offline cache handed to a device contains only fingerprint slot, first
      name and an allow/deny flag — no biometric data, no personal details.
- [x] Devices have read-only access to member data and cannot write anything except
      attendance and their own heartbeat.

## Biometric data

- [x] No fingerprint template or image is stored in PostgreSQL. The R503Pro holds
      templates locally; the database stores only the slot-to-member mapping.
- [x] A sensor slot is unique per device, so two terminals cannot collide.
- [x] Removing a fingerprint clears the mapping and keeps the member record and all
      historical attendance.
- [x] Membership expiry denies access but never deletes the template.

## Input and transport

- [x] All input is validated with Zod in server actions and re-validated by
      Postgres constraints.
- [x] Edge Functions validate payload shape, timestamps and device identity before
      any write.
- [x] The magic-link `next` parameter only accepts same-origin relative paths, so it
      cannot be used as an open redirect.
- [x] Security headers set in `next.config.mjs`: `X-Frame-Options: DENY`,
      `nosniff`, `strict-origin-when-cross-origin`, and camera/mic/geolocation
      disabled.
- [x] `super-admin-login` rate-limits to 8 attempts per username per 15 minutes and
      returns an identical response for unknown user and wrong password.

## Storage

- [x] `profile-images` is private; images are served through signed URLs and the
      policy keys off the owner's uid in the object path.
- [x] Uploads are restricted by MIME type and to 2 MB, and are downscaled in the
      browser before upload.
- [x] `branding` is public (logo only). `workout-files` is private.

## Known limitations

- **Membership claiming.** A member self-signing up proves only that they know a
  membership ID. The claimed record is therefore created or linked as `inactive`
  and grants no door access until staff record a payment. If the gym wants a
  stronger check, add a reception-issued claim code to the flow.
- **Rate limiting** on `super-admin-login` is per Edge Function isolate, so it is a
  brake rather than a guarantee. Put real rate limiting at the gateway if the
  endpoint is ever exposed to the open internet at volume.
- **Signed avatar URLs** are minted with a one-year expiry and stored on the member
  row. If images become sensitive, shorten the expiry and sign on read instead.

## Physical safety

- [ ] Emergency egress is mechanical and independent of the ESP32, the network,
      Supabase and Vercel. **Verify with the device powered off.**
- [ ] A production entrance uses a commercially rated access-control lock, not the
      prototype 12 V solenoid.
