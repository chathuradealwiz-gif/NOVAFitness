-- NOVA FITNESS — Row Level Security
--
-- Rules (spec "Role enforcement"):
--   super_admin  full access
--   admin        management access, no admin-account management, no payment voiding
--   user         their own member row and its children, read-only
--
-- Edge Functions that act on behalf of a device use the service-role key and
-- bypass RLS deliberately; every one of them validates the device itself.

alter table profiles            enable row level security;
alter table members             enable row level security;
alter table memberships         enable row level security;
alter table payments            enable row level security;
alter table attendance          enable row level security;
alter table devices             enable row level security;
alter table workout_plans       enable row level security;
alter table workout_exercises   enable row level security;
alter table workout_files       enable row level security;
alter table meal_plans          enable row level security;
alter table meal_plan_items     enable row level security;
alter table broadcast_messages  enable row level security;
alter table gym_settings        enable row level security;
alter table audit_logs          enable row level security;
alter table financial_audit_logs enable row level security;

-- ---------------------------------------------------------------- profiles

create policy profiles_self_read on profiles
  for select using (user_id = auth.uid());

create policy profiles_staff_read on profiles
  for select using (is_staff());

create policy profiles_self_update on profiles
  for update using (user_id = auth.uid())
  -- A user must not be able to promote themselves.
  with check (user_id = auth.uid() and role = current_user_role());

-- Only the super admin creates/edits admin accounts (spec §65).
create policy profiles_super_admin_all on profiles
  for all using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------- members

create policy members_self_read on members
  for select using (user_id = auth.uid());

-- Deliberately NO member UPDATE policy. RLS cannot restrict which *columns* a
-- statement touches, so a self-update policy would let a member set their own
-- `status` or `membership_id`. Members edit their contact details through
-- update_own_member_profile() instead (see 0006_member_signup.sql), which writes
-- only the safe columns.

create policy members_staff_all on members
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------- memberships

create policy memberships_self_read on memberships
  for select using (member_id = current_member_id());

create policy memberships_staff_all on memberships
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------- payments

-- A member sees their own payment history and nothing else (spec §46, §48).
create policy payments_self_read on payments
  for select using (member_id = current_member_id());

create policy payments_staff_read on payments
  for select using (is_staff());

create policy payments_staff_insert on payments
  for insert with check (is_staff());

-- Voiding/refunding is a super-admin action; admins record payments only (spec §48).
create policy payments_super_admin_update on payments
  for update using (is_super_admin()) with check (is_super_admin());

-- Financial records are never deleted — no DELETE policy exists (spec §44).

-- ---------------------------------------------------------------- attendance

create policy attendance_self_read on attendance
  for select using (member_id = current_member_id());

create policy attendance_staff_read on attendance
  for select using (is_staff());

create policy attendance_staff_write on attendance
  for insert with check (is_staff());

-- ---------------------------------------------------------------- devices

create policy devices_staff_read on devices
  for select using (is_staff());

create policy devices_super_admin_all on devices
  for all using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------- plans

create policy workout_plans_self_read on workout_plans
  for select using (member_id = current_member_id());

create policy workout_plans_staff_all on workout_plans
  for all using (is_staff()) with check (is_staff());

create policy workout_exercises_self_read on workout_exercises
  for select using (exists (
    select 1 from workout_plans p
    where p.id = workout_plan_id and p.member_id = current_member_id()
  ));

create policy workout_exercises_staff_all on workout_exercises
  for all using (is_staff()) with check (is_staff());

create policy workout_files_self_read on workout_files
  for select using (exists (
    select 1 from workout_plans p
    where p.id = workout_plan_id and p.member_id = current_member_id()
  ));

create policy workout_files_staff_all on workout_files
  for all using (is_staff()) with check (is_staff());

create policy meal_plans_self_read on meal_plans
  for select using (member_id = current_member_id());

create policy meal_plans_staff_all on meal_plans
  for all using (is_staff()) with check (is_staff());

create policy meal_items_self_read on meal_plan_items
  for select using (exists (
    select 1 from meal_plans p
    where p.id = meal_plan_id and p.member_id = current_member_id()
  ));

create policy meal_items_staff_all on meal_plan_items
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------- broadcasts

-- Members only ever see live, non-archived banners (spec §58).
create policy broadcasts_public_read on broadcast_messages
  for select using (
    archived_at is null
    and is_active
    and start_at <= now()
    and (end_at is null or end_at >= now())
  );

create policy broadcasts_staff_all on broadcast_messages
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------- settings

-- Everyone signed in may read branding/WhatsApp link; only staff may change it.
create policy gym_settings_read on gym_settings
  for select using (auth.uid() is not null);

create policy gym_settings_staff_update on gym_settings
  for update using (is_staff()) with check (is_staff());

create policy gym_settings_super_admin_insert on gym_settings
  for insert with check (is_super_admin());

-- ---------------------------------------------------------------- audit

create policy audit_logs_staff_read on audit_logs
  for select using (is_staff());

create policy financial_audit_read on financial_audit_logs
  for select using (is_staff());

-- Audit rows are written by SECURITY DEFINER triggers; no client INSERT policy.
