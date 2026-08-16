-- NOVA FITNESS — core schema
-- Spec: Gym_Management_System_Claude_Specification(2).md
--
-- Design notes
--  * membership_id (e.g. NOVA-00125) is the gym's business identifier (spec §39).
--  * fingerprint_id is a device-local R503Pro template slot. The two are NEVER the
--    same value and the fingerprint slot is only unique *per device*.
--  * No raw biometric template is ever stored here (spec "Database").

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------- enums

create type user_role         as enum ('super_admin', 'admin', 'user');
create type member_status     as enum ('active', 'expired', 'suspended', 'inactive');
create type attendance_event  as enum ('entry', 'exit');
create type device_status     as enum ('online', 'offline', 'disabled');
create type payment_type      as enum ('registration', 'monthly_membership', 'personal_coaching', 'other');
create type payment_status    as enum ('paid', 'voided', 'refunded');
create type plan_status       as enum ('active', 'completed', 'archived');
create type banner_type       as enum ('info', 'success', 'warning', 'danger');

-- ---------------------------------------------------------------- profiles

create table profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  -- Only the super admin uses a username; admins/members sign in by magic link.
  username          text unique,
  full_name         text,
  email             text not null,
  phone             text,
  role              user_role not null default 'user',
  profile_image_url text,
  is_active         boolean not null default true,
  must_change_password boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index profiles_role_idx  on profiles (role);
create index profiles_email_idx on profiles (lower(email));

-- ---------------------------------------------------------------- devices

create table devices (
  id               uuid primary key default gen_random_uuid(),
  device_code      text not null unique,           -- e.g. GYM-001
  name             text not null,
  location         text,
  status           device_status not null default 'offline',
  last_seen_at     timestamptz,
  firmware_version text,
  network_status   text,                           -- reported by the A7670C
  pending_events   integer not null default 0,
  last_sync_at     timestamptz,
  -- Device auth: only the bcrypt-style hash of the device key lives here.
  api_key_hash     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index devices_heartbeat_idx on devices (last_seen_at desc);

-- ---------------------------------------------------------------- members

create table members (
  id                    uuid primary key default gen_random_uuid(),
  -- Links the member record to a magic-link auth identity once they sign up.
  user_id               uuid unique references auth.users (id) on delete set null,
  membership_id         text not null unique,      -- NOVA-00125  (spec §39)
  full_name             text not null,
  email                 text,
  phone                 text,
  date_of_birth         date,
  gender                text,
  address               text,
  emergency_contact     text,
  profile_image_url     text,
  join_date             date not null default current_date,
  status                member_status not null default 'inactive',
  -- Denormalised from the payment history; maintained by triggers (spec §45).
  membership_start      date,
  membership_end        date,
  next_payment_date     date,
  -- Device-local biometric slot (spec §60). NULL = no fingerprint enrolled.
  fingerprint_id        integer,
  fingerprint_device_id uuid references devices (id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint members_fingerprint_pair_ck check (
    (fingerprint_id is null and fingerprint_device_id is null)
    or (fingerprint_id is not null and fingerprint_device_id is not null)
  )
);

-- A sensor slot may only be assigned to one member per device at a time.
create unique index members_fingerprint_slot_uidx
  on members (fingerprint_device_id, fingerprint_id)
  where fingerprint_id is not null;

create index members_status_idx        on members (status);
create index members_membership_end_idx on members (membership_end);
create index members_membership_id_idx on members (membership_id);
create index members_search_idx        on members using gin (
  (coalesce(full_name, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(email, '')) gin_trgm_ops
);

-- ---------------------------------------------------------------- memberships / payments

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members (id) on delete cascade,
  plan_name  text not null default 'Monthly Membership',
  start_date date not null,
  end_date   date not null,
  amount     numeric(12, 2),
  status     text not null default 'active',
  created_at timestamptz not null default now()
);

create index memberships_member_idx on memberships (member_id, end_date desc);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members (id) on delete restrict,
  payment_type  payment_type not null,
  amount        numeric(12, 2) not null check (amount >= 0),
  currency      text not null default 'LKR',
  payment_date  date not null default current_date,
  -- Only membership/coaching payments carry a period.
  period_start  date,
  period_end    date,
  coach_name    text,
  description   text,
  recorded_by   uuid references profiles (id) on delete set null,
  status        payment_status not null default 'paid',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint payments_period_ck check (period_end is null or period_start is null or period_end >= period_start)
);

create index payments_member_idx on payments (member_id, payment_date desc);
create index payments_date_idx   on payments (payment_date desc);
create index payments_type_idx   on payments (payment_type, status);
create index payments_period_idx on payments (member_id, period_end desc)
  where status = 'paid' and payment_type = 'monthly_membership';

-- ---------------------------------------------------------------- attendance

create table attendance (
  id            uuid primary key default gen_random_uuid(),
  -- Generated on the ESP32 so a replayed offline queue cannot duplicate rows.
  event_id      text not null unique,
  member_id     uuid references members (id) on delete set null,
  fingerprint_id integer,
  device_id     uuid references devices (id) on delete set null,
  event_type    attendance_event not null,
  occurred_at   timestamptz not null,
  authorized    boolean not null default true,
  denial_reason text,
  offline_event boolean not null default false,
  sync_status   text not null default 'synced',
  created_at    timestamptz not null default now()
);

create index attendance_occurred_idx  on attendance (occurred_at desc);
create index attendance_member_idx    on attendance (member_id, occurred_at desc);
create index attendance_device_idx    on attendance (device_id, occurred_at desc);

-- ---------------------------------------------------------------- workout / meal plans

create table workout_plans (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  title       text not null,
  description text,
  assigned_by uuid references profiles (id) on delete set null,
  trainer_name text,
  start_date  date,
  end_date    date,
  status      plan_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index workout_plans_member_idx on workout_plans (member_id, status);

create table workout_exercises (
  id              uuid primary key default gen_random_uuid(),
  workout_plan_id uuid not null references workout_plans (id) on delete cascade,
  day             text not null,          -- 'monday' … 'sunday'
  exercise_name   text not null,
  sets            integer,
  reps            text,                   -- free text: '12', '8-10', 'AMRAP'
  duration        text,                   -- '20 min'
  weight          text,
  notes           text,
  sort_order      integer not null default 0
);

create index workout_exercises_plan_idx on workout_exercises (workout_plan_id, day, sort_order);

create table workout_files (
  id              uuid primary key default gen_random_uuid(),
  workout_plan_id uuid not null references workout_plans (id) on delete cascade,
  file_path       text not null,
  file_type       text,
  created_at      timestamptz not null default now()
);

create table meal_plans (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  title       text not null,
  description text,
  assigned_by uuid references profiles (id) on delete set null,
  start_date  date,
  end_date    date,
  status      plan_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index meal_plans_member_idx on meal_plans (member_id, status);

create table meal_plan_items (
  id           uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans (id) on delete cascade,
  day          text not null,
  meal_type    text not null,             -- breakfast | lunch | snack | dinner
  description  text not null,
  calories     integer,
  notes        text,
  sort_order   integer not null default 0
);

create index meal_plan_items_plan_idx on meal_plan_items (meal_plan_id, day, sort_order);

-- ---------------------------------------------------------------- broadcasts / settings

create table broadcast_messages (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  message     text not null,
  banner_type banner_type not null default 'info',
  priority    integer not null default 0,
  dismissible boolean not null default true,
  is_active   boolean not null default true,
  archived_at timestamptz,                 -- soft delete (spec §57)
  start_at    timestamptz not null default now(),
  end_at      timestamptz,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index broadcast_active_idx on broadcast_messages (is_active, start_at, end_at)
  where archived_at is null;

create table gym_settings (
  id                     uuid primary key default gen_random_uuid(),
  gym_name               text not null default 'NOVA FITNESS',
  logo_path              text,
  whatsapp_url           text,                       -- supplied by the gym later
  phone                  text,
  email                  text,
  address                text,
  monthly_membership_fee numeric(12, 2) not null default 0,
  registration_fee       numeric(12, 2) not null default 0,
  currency               text not null default 'LKR',
  scan_cooldown_seconds  integer not null default 30, -- duplicate-scan window
  updated_by             uuid references profiles (id) on delete set null,
  updated_at             timestamptz not null default now(),
  -- Single-row table.
  singleton              boolean not null default true unique check (singleton)
);

-- ---------------------------------------------------------------- audit

create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  old_data      jsonb,
  new_data      jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx  on audit_logs (actor_user_id, created_at desc);

create table financial_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid references payments (id) on delete set null,
  action       text not null,               -- created | updated | voided | refunded
  old_value    jsonb,
  new_value    jsonb,
  performed_by uuid references profiles (id) on delete set null,
  reason       text,
  created_at   timestamptz not null default now()
);

create index financial_audit_payment_idx on financial_audit_logs (payment_id, created_at desc);
