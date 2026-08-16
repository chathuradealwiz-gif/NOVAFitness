# NOVA FITNESS — Deployment

## 1. Supabase

Create a project, then from the repository root:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migrations apply in order:

| File | Contents |
|------|----------|
| `0001_schema.sql` | tables, enums, indexes |
| `0002_functions.sql` | period maths, membership recompute, audit triggers, access decision |
| `0003_rls.sql` | Row Level Security for all tables |
| `0004_storage_and_reports.sql` | storage buckets + policies, dashboard/report RPCs, seed row |
| `0005_enrollment.sql` | fingerprint enrollment handshake |
| `0006_member_signup.sql` | member self-signup claim function |

Deploy the Edge Functions:

```bash
supabase functions deploy attendance device-heartbeat device-sync \
  member-lookup fingerprint-assignment super-admin-login
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
into functions automatically — do not add them as secrets by hand.

### Auth settings

In **Authentication → URL Configuration** set the site URL and add
`https://<your-domain>/auth/callback` to the redirect allow-list. Do the same for
`http://localhost:3000/auth/callback` while developing. Magic links are on by
default; leave "Confirm email" enabled.

### Nightly expiry job

Membership expiry is evaluated live on every access decision, so this is a
housekeeping job to keep the dashboard counts tidy. With `pg_cron` enabled:

```sql
select cron.schedule(
  'expire-memberships', '5 0 * * *',
  $$ select expire_lapsed_memberships(); $$
);
```

### Bootstrap

```bash
node scripts/bootstrap-super-admin.mjs
node scripts/provision-device.mjs GYM-001 "Main Entrance" "Front door"
```

Then sign in and set the gym's fees, logo and WhatsApp link under
**Gym Settings** — none of these are hard-coded.

---

## 2. Vercel

Import the repository and set the environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `NEXT_PUBLIC_SITE_URL` | your production URL |

**Do not set `SUPABASE_SERVICE_ROLE_KEY` in Vercel.** Nothing the deployed app does
needs it; it is only used by the local bootstrap scripts. Leaving it out means a
compromised deployment cannot bypass RLS.

`npm run build` is the build command; no other configuration is needed.

### Staying inside the free tier

The app is built to keep work off Vercel:

- dashboard figures come from aggregate RPCs (`dashboard_stats`,
  `financial_report`, `revenue_trend`, `attendance_trend`), not table scans
- lists are paginated server-side (25 members, 50 attendance/payment rows)
- CSV export is generated in the browser
- charts are inline SVG, so there is no charting library in the bundle
- device traffic goes to Supabase Edge Functions and never touches Vercel
- there is no polling; pages refresh on user action

First-load JS is roughly 90 kB on the member pages.

---

## 3. Device

Flash the firmware (stage 5–8, not yet built), then store the device code and key
from `provision-device.mjs` in NVS. Confirm the terminal appears as **Online** on
the Devices page within a minute.

---

## Post-deployment checks

- [ ] magic link sign-in works for an admin and for a member
- [ ] super admin sign-in works with the production password
- [ ] a member cannot reach `/dashboard` (redirects to `/member`)
- [ ] recording a monthly payment moves an expired member to Active with the
      correct period and next payment date
- [ ] a deactivated profile lands on Access Denied
- [ ] the device shows Online, and a scan appears in Attendance
- [ ] the emergency exit release works with the ESP32 powered off
