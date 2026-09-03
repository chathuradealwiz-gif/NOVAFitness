# NOVA FITNESS — Gym Management & Biometric Access

Membership, payment, attendance and access-control system for NOVA FITNESS,
built to the specification in [`docs/Gym_Management_System_Claude_Specification(2).md`](docs/Gym_Management_System_Claude_Specification(2).md).

```text
Fingerprint / TFT / Door hardware
            │
        ESP32-S3  ──  A7670C 4G  ──  HTTPS
            │
   Supabase Edge Functions
            │
   Supabase PostgreSQL (RLS)
            │
      Next.js web app  ──  Vercel
```

The ESP32 never talks to PostgreSQL directly and never holds the service-role key.

---

## What is built

| Stage | Scope | Status |
|-------|-------|--------|
| 1 | Supabase schema, indexes, triggers, RLS | ✅ |
| 2 | Authentication and the three roles | ✅ |
| 3 | Admin dashboard + mobile-first member app | ✅ |
| 4 | Edge Functions (attendance, sync, heartbeat, enrollment, lookup) | ✅ |
| 5–8 | ESP32 firmware: TFT, R307 sensor, relay/door, A7670C | ⏳ not started |
| 9–10 | Device-side sync + offline queue (server contract is ready) | ⏳ not started |
| 13 | Soldered electronics and enclosure | ⏳ not started |

The firmware is deliberately the next stage rather than part of this one — the spec
asks for each stage to be verified before continuing, and the firmware needs the
physical hardware in hand to test. The server side of every device interaction
(authentication, idempotent attendance, offline queue drain, offline authorisation
cache, enrollment handshake) is complete and documented in
[`docs/API.md`](docs/API.md), so the firmware has a fixed contract to build against.

---

## Repository layout

```text
NOVAFITNESS/
├── src/
│   ├── app/
│   │   ├── login/            magic link + super admin sign-in
│   │   ├── auth/             callback and sign-out routes
│   │   ├── dashboard/        admin & super admin (desktop-dense, still responsive)
│   │   └── member/           member app (mobile-first, bottom nav)
│   ├── components/           shared UI + brand mark
│   ├── lib/
│   │   ├── actions/          server actions — every mutation, role-checked
│   │   ├── auth/             session helpers and route guards
│   │   └── supabase/         browser / server / middleware clients
│   ├── types/                database types
│   └── middleware.ts         session refresh + role-based routing
├── supabase/
│   ├── migrations/           schema, business logic, RLS, storage, RPCs
│   └── functions/            Edge Functions (Deno)
├── scripts/                  super-admin bootstrap, device provisioning
└── docs/                     spec, API, deployment, security, testing
```

---

## Local setup

**Prerequisites:** Node 20+, a Supabase project, the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL and keys
```

Apply the database:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Deploy the Edge Functions:

```bash
supabase functions deploy attendance device-heartbeat device-sync member-lookup fingerprint-assignment super-admin-login
```

Create the super admin (see the security note below):

```bash
node scripts/bootstrap-super-admin.mjs
```

Run it:

```bash
npm run dev
```

Open http://localhost:3000. Admins and members sign in with a magic link; the super
admin uses the username/password form behind the "Super Admin sign in" link.

---

## The super admin credential

The spec names `nuwan / 1234` as a bootstrap credential. It is **not** hard-coded
anywhere in this repository — not in the frontend, not in the firmware, not in a
committed `.env`, and it is never returned by an API or shown in the UI.

Instead the super admin is an ordinary Supabase Auth user, so Supabase performs the
password hashing and verification. `scripts/bootstrap-super-admin.mjs` creates that
user from environment variables and refuses to run with a password under 12
characters unless you pass `--allow-weak` for local development. The
`super-admin-login` Edge Function is the server-side username → identity lookup that
lets that user sign in as `nuwan` instead of by email.

Before production: set a strong password, enable MFA in Supabase Auth, and rotate
anything used during development.

---

## Register a device

```bash
node scripts/provision-device.mjs GYM-001 "Main Entrance" "Front door"
```

The device key is printed once. Only its SHA-256 hash is stored. Put the key in the
ESP32's NVS — never in Git or in firmware source. Re-running the script rotates the
key and immediately invalidates the old one.

---

## Key business rules

**Membership ID vs fingerprint ID** (spec §39) — `members.membership_id`
(`34`) is the gym's official identifier and is what the UI shows. The
fingerprint ID is a device-local sensor slot, unique only per device
(`UNIQUE (fingerprint_device_id, fingerprint_id)`), and is never presented as a
member's gym ID.

**Monthly period** (spec §42) — one calendar month, not 30 days:
`period_end = period_start + 1 month − 1 day`. A payment on 16 Aug covers
16 Aug – 15 Sep with the next payment due 16 Sep. Renewing early continues from the
day after the current period ends rather than discarding the remaining days.

**Payments drive access** (spec §45, §61) — the paid payment history is the source
of truth for membership periods. Recording a monthly payment extends the period and
activates the member automatically, via database triggers, so the rule holds
regardless of which client writes the row. `suspended` is the one deliberate hold
that a payment will not lift — staff must un-suspend explicitly. `inactive` means
"not yet activated or lapsed", which is exactly what a payment clears. Manual status
changes require a reason and are written to the audit log.

**Financial records are immutable** — a trigger rejects edits to a payment's amount,
type, date or member. Corrections happen by voiding and re-recording, and every
correction lands in `financial_audit_logs`. There is no DELETE policy on `payments`.

**Fingerprints outlive membership** — expiry denies access but never deletes the
template or the attendance history. Removing a fingerprint clears the mapping only.

---

## Further documentation

- [`docs/API.md`](docs/API.md) — Edge Function contracts, the ESP32 integration flow
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase and Vercel deployment
- [`docs/SECURITY.md`](docs/SECURITY.md) — security checklist
- [`docs/TESTING.md`](docs/TESTING.md) — testing plan
