-- Clear the fingerprint enrolments left behind by the R503.
--
-- The gym moved from the 200-template R503 to a 1000-template R307, which the
-- 500-member roster needs. The two are not interchangeable at the template
-- level: the R503 is capacitive and the R307 optical, so their feature
-- encodings differ and no template captured on one will ever match on the
-- other. There is nothing to migrate — only mappings to clear.
--
-- What every remaining R503 row means after the swap:
--
--   members.fingerprint_id      "this member is in sensor slot 37". Slot 37 on
--                               the new R307 is empty, so the mapping points at
--                               nothing. Left in place it would make the
--                               dashboard show members as enrolled, hide them
--                               from the "needs a fingerprint" work, and hand
--                               free_slot() a slot it believes is taken.
--   fingerprint_templates       backups of R503 captures. Unusable on an R307,
--                               and fingerprint-template already refuses to
--                               restore them — but holding biometric data that
--                               can never serve a purpose is not defensible.
--   fingerprint_erasures        "delete slot 37 from the sensor". The sensor
--                               those slots lived in is gone.
--   enrollment_requests         captures aimed at hardware no longer fitted.
--
-- Attendance is NOT touched. Those rows are the record of who came to the gym
-- and when; their fingerprint_id is a historical fact about a scan that really
-- happened, not a live mapping. Nothing here deletes a member, a payment or a
-- visit.
--
-- After this runs, every member shows as "no fingerprint enrolled" and staff
-- re-enrol them on the R307 from the member page. That re-enrolment is
-- unavoidable — it is exactly the cost the new backup table exists to make
-- sure is never paid twice.

-- 1. Templates first. The trigger added in 0017 would clear these as a
--    consequence of step 2, but doing it explicitly also catches any row whose
--    member mapping was already gone.
delete from fingerprint_templates;

-- 2. The mappings. members_audit_status() logs one `fingerprint_change` row per
--    member as this runs, so the mass unassignment is visible in the audit
--    trail rather than appearing as data that quietly vanished.
update members
   set fingerprint_id        = null,
       fingerprint_device_id = null,
       updated_at            = now()
 where fingerprint_id is not null
    or fingerprint_device_id is not null;

-- 3. Outstanding erasures. Closed rather than deleted: the queue is a record of
--    what was asked for, and the honest end state is "erased" — the templates
--    are gone with the hardware, which is what the request wanted.
update fingerprint_erasures
   set erased_at = now()
 where erased_at is null;

-- 4. Enrolments that were waiting on the old sensor. A pending request would be
--    claimed by the R307 the moment it comes online and run a capture nobody at
--    the desk is expecting.
update enrollment_requests
   set status        = 'cancelled',
       error_message = 'Cancelled: fingerprint sensor replaced (R503 to R307)',
       updated_at    = now()
 where status in ('pending', 'in_progress');
