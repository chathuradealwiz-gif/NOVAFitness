-- Component health for the Devices page.
--
-- The terminal is outbound-only behind the gym's router, so the dashboard can
-- never poll it. Health rides along on the heartbeat the device already sends
-- every HEARTBEAT_SECONDS, and is stored here as the last thing it reported.
-- The dashboard shows that snapshot with its age, so nothing on the page can
-- pretend to be a live reading when it is a minute old.
--
-- jsonb rather than columns: this is diagnostic telemetry that will grow new
-- fields (a door relay, a 4G modem) and none of it is queried relationally.

alter table devices add column if not exists health jsonb;
alter table devices add column if not exists health_reported_at timestamptz;

comment on column devices.health is
  'Last component health snapshot reported by the device on its heartbeat.';
