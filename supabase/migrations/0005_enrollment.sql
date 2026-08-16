-- NOVA FITNESS — fingerprint enrollment handshake (spec "Fingerprint Enrollment")
--
-- Admin presses "Enroll Fingerprint" in the dashboard, which creates a request.
-- The device picks it up on its next poll, enters enrollment mode, and reports the
-- slot the R503Pro allocated. Only then is the mapping written to `members`.

create type enrollment_status as enum ('pending', 'in_progress', 'completed', 'failed', 'cancelled');

create table enrollment_requests (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members (id) on delete cascade,
  device_id      uuid not null references devices (id) on delete cascade,
  status         enrollment_status not null default 'pending',
  fingerprint_id integer,
  error_message  text,
  requested_by   uuid references profiles (id) on delete set null,
  -- Requests go stale if the member never walks up to the device.
  expires_at     timestamptz not null default now() + interval '10 minutes',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- At most one live request per device, so two admins cannot race the sensor.
create unique index enrollment_active_device_uidx
  on enrollment_requests (device_id)
  where status in ('pending', 'in_progress');

create index enrollment_member_idx on enrollment_requests (member_id, created_at desc);

create trigger enrollment_touch before update on enrollment_requests
  for each row execute function touch_updated_at();

alter table enrollment_requests enable row level security;

create policy enrollment_staff_all on enrollment_requests
  for all using (is_staff()) with check (is_staff());

create policy enrollment_self_read on enrollment_requests
  for select using (member_id = current_member_id());

-- Frees the sensor after an abandoned enrollment.
create or replace function public.expire_stale_enrollments()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update enrollment_requests
     set status = 'failed', error_message = 'Timed out', updated_at = now()
   where status in ('pending', 'in_progress')
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
