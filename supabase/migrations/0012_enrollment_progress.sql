-- NOVA FITNESS — live enrollment progress.
--
-- The device walks the member through a four-step capture (place, lift, place
-- again, save). Without these columns the dashboard can only say "in progress"
-- and staff standing next to the member cannot tell a slow scan from a stuck
-- one. The device reports each step; the member page renders it as a percentage.

alter table enrollment_requests
  add column progress_step    smallint not null default 0,
  add column progress_total   smallint not null default 4,
  add column progress_message text;

comment on column enrollment_requests.progress_step is
  'Last capture step the device reported, 0-4. 0 = not started.';
comment on column enrollment_requests.progress_message is
  'Human-readable instruction the device is showing the member right now.';
