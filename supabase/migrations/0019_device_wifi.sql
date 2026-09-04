-- Wi-Fi visibility and remote switching for the Devices page.
--
-- The terminal is outbound-only behind the gym's router, so nothing here is a
-- live channel: a command is parked on the device row and collected on the
-- next device-sync, and the answer arrives on the sync after that. Two
-- heartbeat intervals, not two seconds - the dashboard says so rather than
-- pretending otherwise.
--
-- Which network the door is on already rides along in devices.health as
-- health->>'ssid'; this migration is only about the command channel and the
-- scan results, which are too big and too transient to belong in a health
-- snapshot.

create table if not exists device_wifi_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  action text not null check (action in ('scan', 'connect')),
  ssid text,
  -- Plain text, and deliberately short-lived: the ESP32 has to present the
  -- real password to the router, so it cannot be hashed. delivered_at clears
  -- it (see the trigger below) so a used credential does not sit in the
  -- database forever. Nobody but the service role can read this table.
  password text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'done', 'failed', 'expired')),
  result text,
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  completed_at timestamptz
);

create index if not exists device_wifi_commands_pending_idx
  on device_wifi_commands (device_id, created_at desc)
  where status in ('pending', 'sent');

comment on table device_wifi_commands is
  'Wi-Fi scan/switch requests from the Devices page, collected by the terminal on its next sync.';

-- The last scan the device reported. On the device row rather than in the
-- command table because it is the current answer to "what can this door see",
-- and it outlives the command that produced it.
alter table devices add column if not exists wifi_networks jsonb;
alter table devices add column if not exists wifi_networks_at timestamptz;

comment on column devices.wifi_networks is
  'Last [{ssid, rssi}] the device reported from a scan, strongest first.';

-- Locked down: only the service role (the Edge Functions) touches this table.
-- The dashboard writes through a server action that uses the same client the
-- rest of the app does, so it needs its own policy for staff inserts.
alter table device_wifi_commands enable row level security;

drop policy if exists device_wifi_commands_super_admin on device_wifi_commands;
create policy device_wifi_commands_super_admin on device_wifi_commands
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  );

-- A command nobody collected is worse than no command: a door that was offline
-- all night should not switch networks the moment it comes back to a decision
-- somebody made twelve hours ago and has long since worked around.
create or replace function expire_stale_wifi_commands()
returns void
language sql
as $$
  update device_wifi_commands
  set status = 'expired',
      result = 'not collected in time',
      completed_at = now()
  where status in ('pending', 'sent')
    and created_at < now() - interval '15 minutes';
$$;
