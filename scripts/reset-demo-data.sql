-- Clear test data before handing the system over.
--
-- KEPT: profiles, devices, gym_settings, fingerprint_erasures,
--       device_wifi_commands.
-- CLEARED: every member and the records hanging off them, plus both audit
--          trails.
--
-- fingerprint_backup_status is a view over templates+members, so it empties
-- itself; there is nothing to delete there.
--
-- fingerprint_erasures.member_id is `on delete set null`, so those rows SURVIVE
-- with the device+slot intact. That matters: the outstanding erasure for slot 1
-- is what makes the terminal wipe that template out of the R307's flash on its
-- next sync. Deleting these rows would leave the print on the sensor forever.
--
-- fingerprint_templates.member_id is the primary key with `on delete cascade`,
-- so the backup templates go with their members. Intended: a template with no
-- member restores a print nobody is authorised on.
--
-- Order matters. payments.member_id is `on delete restrict` — members will not
-- delete until the payments are gone.
--
-- Run once against the project database:
--   psql "$DATABASE_URL" -f scripts/reset-demo-data.sql

begin;

-- Audit trails first: they reference profiles, not members, so nothing else
-- forces this ordering — but clearing them last would just re-log the deletes.
delete from financial_audit_logs;
delete from audit_logs;

-- Plan contents. The parents cascade to these, but being explicit keeps the
-- row counts below honest about what went.
delete from workout_files;
delete from workout_exercises;
delete from meal_plan_items;

delete from workout_plans;
delete from meal_plans;
delete from broadcast_messages;

delete from attendance;
delete from payments;      -- must precede members (on delete restrict)
delete from memberships;

-- Cascades to enrollment_requests and fingerprint_templates.
-- Nulls fingerprint_erasures.member_id, leaving those queue rows intact.
delete from members;

select 'members'              as table_name, count(*) from members
union all select 'fingerprint_templates',    count(*) from fingerprint_templates
union all select 'fingerprint_erasures',     count(*) from fingerprint_erasures
union all select 'erasures still pending',   count(*) from fingerprint_erasures where erased_at is null
union all select 'profiles (kept)',          count(*) from profiles
union all select 'devices (kept)',           count(*) from devices
union all select 'gym_settings (kept)',      count(*) from gym_settings;

-- Inspect the counts above, then finish with:  commit;
rollback;
