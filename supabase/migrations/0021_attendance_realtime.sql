-- Let an open dashboard hear each scan as it happens.
--
-- The terminal already writes a row to `attendance` for every scan; the TFT
-- shows the decision from the same response. When that screen is dead the
-- staff have no way to know who just walked in without reloading a page. So
-- the browser subscribes to inserts on the table and shows the same welcome
-- (or denial) as a popup.
--
-- This only broadcasts what the caller could already read: Realtime evaluates
-- the existing `attendance_staff_read` / `attendance_self_read` policies for
-- each subscriber, so a member's session receives only their own rows and an
-- anonymous socket receives nothing. No other table is published and no
-- policy changes.

alter publication supabase_realtime add table attendance;
