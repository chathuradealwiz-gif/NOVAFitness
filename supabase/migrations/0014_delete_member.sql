-- NOVA FITNESS — permanently delete a member profile
--
-- "Permanently" here means every piece of personal data is destroyed, including
-- the biometric template on the sensor. It does not mean the payment rows go:
-- payments.member_id is `on delete restrict` and financial records are permanent
-- (spec §44), so deleting them would rewrite past revenue reports. The member
-- row therefore stays as an anonymous stub that the payments still point at,
-- carrying nothing that identifies a person.
--
-- Erasing the fingerprint needs a round trip. The template lives in a slot on
-- the R503 itself, and until now nothing ever told the sensor to erase one:
-- device-sync only rebuilt the authorisation cache, so an unassigned finger was
-- denied at the door but its template stayed on the device forever and the slot
-- was never reused. fingerprint_erasures is that missing instruction queue.

-- 1. Deleted profiles stay out of every roster, search and count.
alter table members add column if not exists deleted_at timestamptz;

create index if not exists members_deleted_at_idx on members (deleted_at)
  where deleted_at is null;

-- 2. Slots the device still has to erase. One row per slot, drained on sync.
create table if not exists fingerprint_erasures (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references devices (id) on delete cascade,
  fingerprint_id integer not null,
  -- Kept only so staff can see which erasure came from which deletion; the
  -- member it points at is already anonymous by the time this row exists.
  member_id      uuid references members (id) on delete set null,
  requested_by   uuid references profiles (id) on delete set null,
  erased_at      timestamptz,
  created_at     timestamptz not null default now()
);

-- Re-requesting an erasure that is still outstanding is a no-op rather than a
-- second queue entry. Partial, not a plain UNIQUE over (device, slot,
-- erased_at): NULLs compare as distinct, so a plain constraint would let two
-- pending rows for the same slot through. Once erased the row stops matching,
-- so a slot re-enrolled and deleted again queues cleanly.
create unique index if not exists fingerprint_erasures_pending_uidx
  on fingerprint_erasures (device_id, fingerprint_id)
  where erased_at is null;

alter table fingerprint_erasures enable row level security;

-- Staff can see the queue; only the service role (the Edge Function) writes it.
drop policy if exists fingerprint_erasures_staff_read on fingerprint_erasures;
create policy fingerprint_erasures_staff_read on fingerprint_erasures
  for select using (is_staff());

-- 3. The deletion itself.
create or replace function public.delete_member_permanently(
  p_member_id uuid,
  p_reason    text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m            members%rowtype;
  v_actor      uuid;
  v_payments   integer;
  v_queued     boolean := false;
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to delete a member.';
  end if;

  select * into m from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.';
  end if;

  if m.deleted_at is not null then
    return jsonb_build_object('status', 'already_deleted');
  end if;

  select id into v_actor from profiles where user_id = auth.uid();
  select count(*) into v_payments from payments where member_id = p_member_id;

  -- Queue the sensor erasure before clearing the columns that name the slot.
  if m.fingerprint_id is not null and m.fingerprint_device_id is not null then
    insert into fingerprint_erasures (device_id, fingerprint_id, member_id, requested_by)
    values (m.fingerprint_device_id, m.fingerprint_id, m.id, v_actor)
    on conflict do nothing;
    v_queued := true;
  end if;

  -- Personal data that is not needed to keep the books straight.
  delete from enrollment_requests where member_id = p_member_id;
  delete from workout_plans        where member_id = p_member_id;
  delete from meal_plans           where member_id = p_member_id;

  -- Attendance is `on delete set null`, so history survives the unlink and the
  -- door logs stay honest without naming anyone.
  update attendance set member_id = null where member_id = p_member_id;

  update members
     set full_name         = 'Deleted member',
         email             = null,
         phone             = null,
         date_of_birth     = null,
         gender            = null,
         address           = null,
         emergency_contact = null,
         profile_image_url = null,
         notes             = null,
         -- Unlinks their magic-link identity, so the member portal stops
         -- showing them anything.
         user_id           = null,
         fingerprint_id        = null,
         fingerprint_device_id = null,
         status            = 'inactive',
         deleted_at        = now(),
         updated_at        = now()
   where id = p_member_id;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, new_data)
  values (
    auth.uid(), 'member_deleted', 'member', p_member_id::text,
    jsonb_build_object(
      'membership_id',      m.membership_id,
      'reason',             trim(p_reason),
      'payments_retained',  v_payments,
      'fingerprint_queued', v_queued
    )
  );

  return jsonb_build_object(
    'status',             'deleted',
    'payments_retained',  v_payments,
    'fingerprint_queued', v_queued
  );
end;
$$;

-- 4. Keep deleted profiles out of staff search.
create or replace function public.search_members(p_query text, p_limit integer default 20)
returns setof members
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select *
    from members m
   where m.deleted_at is null
     and (m.membership_id ilike '%' || p_query || '%'
      or m.full_name     ilike '%' || p_query || '%'
      or m.phone         ilike '%' || p_query || '%'
      or m.email         ilike '%' || p_query || '%'
      or (p_query ~ '^\d+$' and m.fingerprint_id = p_query::integer))
   order by
     (m.membership_id = p_query) desc,
     length(m.membership_id),
     m.full_name
   limit p_limit;
end;
$$;

-- 5. The membership number stays reserved: payments still point at this row, and
--    handing 34 to a new person would make the old receipts read as theirs.
--    next_membership_id() is max + 1, so it never hands one back out anyway.

-- 6. Keep deleted profiles out of the dashboard counts. A deleted member is an
--    anonymous stub kept only so the payment rows have something to point at;
--    counting it as a member would overstate the roster forever.
create or replace function public.dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_members',    (select count(*) from members where deleted_at is null),
    'active_members',   (select count(*) from members where deleted_at is null and status = 'active'),
    'expired_members',  (select count(*) from members where deleted_at is null and status = 'expired'),
    'suspended_members',(select count(*) from members where deleted_at is null and status = 'suspended'),
    'today_attendance', (select count(*) from attendance
                          where occurred_at >= date_trunc('day', now()) and authorized),
    'today_entries',    (select count(*) from attendance
                          where occurred_at >= date_trunc('day', now())
                            and event_type = 'entry' and authorized),
    'today_exits',      (select count(*) from attendance
                          where occurred_at >= date_trunc('day', now())
                            and event_type = 'exit' and authorized),
    'devices_online',   (select count(*) from devices where status = 'online'),
    'devices_offline',  (select count(*) from devices where status <> 'online'),
    'pending_sync',     (select coalesce(sum(pending_events), 0) from devices),
    'today_revenue',    (select coalesce(sum(amount), 0) from payments
                          where status = 'paid' and payment_date = current_date),
    'month_revenue',    (select coalesce(sum(amount), 0) from payments
                          where status = 'paid'
                            and payment_date >= date_trunc('month', current_date)::date),
    'due_this_week',    (select count(*) from members
                          where deleted_at is null
                            and next_payment_date between current_date and current_date + 7)
  ) into result;

  return result;
end;
$$;
