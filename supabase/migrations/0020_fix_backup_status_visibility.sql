-- Make fingerprint_backup_status tell the truth.
--
-- The Devices page has been reporting "N of N fingerprints are not backed up"
-- on a gym where almost all of them were. Not a device fault, and not a stale
-- count: the view could not return any other answer.
--
-- Two decisions in 0017 collide.
--
--   1. fingerprint_templates has RLS enabled with NO policy, deliberately, so
--      that no client of any role can read biometric bytes. That part is right
--      and stays exactly as it is.
--
--   2. The status view was declared `security_invoker = true`, so it runs with
--      the PERMISSIONS OF THE CALLER. Its LEFT JOIN onto fingerprint_templates
--      is therefore evaluated under the caller's RLS - which returns nothing.
--
-- So `t.member_id is null` was true for every row, and `backed_up` was false
-- for every member, permanently, no matter how many templates were safely
-- stored. The figure was not drifting out of date; it was never capable of
-- being right.
--
-- That is worse than a cosmetic bug. The whole point of the warning is to tell
-- staff when a sensor failure would cost them re-enrolling everybody. A banner
-- that cries wolf on day one is one nobody reads on the day it matters.
--
-- The fix is to let the view - and only the view - see the join, while keeping
-- every byte of biometric data as unreachable as before.
--
-- Why not simply drop security_invoker and leave it there: the view is granted
-- to `authenticated`, which includes members signing in to their own app. A
-- definer view with no predicate would hand any signed-in member the full
-- roster - every name, membership number and sensor slot in the gym. That
-- trades a false warning for a data leak. So the view is gated on is_staff(),
-- the same helper every staff-facing RLS policy in 0003 uses, and a member
-- querying it gets zero rows rather than somebody else's details.
--
-- What this view still does NOT expose, to be explicit: `template`, the bytes
-- themselves. It reports a boolean, a model name and a timestamp. The bytes
-- remain readable only by the Edge Functions on the service-role key, which is
-- the rule 0017 set and this migration keeps.

create or replace view fingerprint_backup_status
with (security_invoker = false) as
  select m.id            as member_id,
         m.membership_id,
         m.full_name,
         m.fingerprint_id,
         (t.member_id is not null) as backed_up,
         t.sensor_model,
         t.updated_at    as backed_up_at
    from members m
    left join fingerprint_templates t on t.member_id = m.id
   where m.fingerprint_id is not null
     -- Staff only. Without this, security_invoker = false would expose the
     -- whole roster to any authenticated user, members included.
     and is_staff();

grant select on fingerprint_backup_status to authenticated;
