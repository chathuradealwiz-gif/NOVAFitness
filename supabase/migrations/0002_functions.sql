-- NOVA FITNESS — business logic
--
-- MONTHLY PERIOD RULE (spec §42 — "do not blindly add 30 days")
--   period_start = payment date (or the day after the current period ends, when
--                  renewing early so the member is not charged for lost days)
--   period_end   = period_start + 1 calendar month - 1 day
--   next payment = period_end + 1 day
--
--   16 Aug -> 15 Sep, next 16 Sep
--   31 Jan -> 27 Feb (28 Feb - 1), next 28 Feb   [Postgres clamps 31 Jan + 1 month
--                                                 to 28/29 Feb, then -1 day]

set check_function_bodies = off;

-- ---------------------------------------------------------------- helpers

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Current caller's role. SECURITY DEFINER so RLS policies on `profiles` cannot
-- recurse into themselves.
-- NOT named `current_role`: that is an SQL keyword function in Postgres and the
-- unqualified call in a policy would resolve to the built-in instead of this one.
create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and is_active
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and is_active and role = 'super_admin'
  );
$$;

-- The member row belonging to the caller, if any.
create or replace function public.current_member_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- period maths

create or replace function public.membership_period_end(p_start date)
returns date language sql immutable as $$
  select (p_start + interval '1 month')::date - 1;
$$;

-- Where a new membership period should start: today (or the payment date), unless
-- the member still has a paid period running — then it continues from that.
create or replace function public.next_period_start(p_member_id uuid, p_payment_date date)
returns date language sql stable security definer set search_path = public as $$
  select greatest(
    p_payment_date,
    coalesce(
      (select max(period_end) + 1
         from payments
        where member_id = p_member_id
          and status = 'paid'
          and payment_type = 'monthly_membership'
          and period_end is not null),
      p_payment_date
    )
  );
$$;

-- ---------------------------------------------------------------- membership state

-- Recomputes members.membership_start/end/next_payment_date/status from the paid
-- payment history, which is the source of truth (spec §45).
-- Manual overrides of `suspended` / `inactive` are never overwritten.
create or replace function public.recompute_member_membership(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start  date;
  v_end    date;
  v_status member_status;
begin
  select min(period_start), max(period_end)
    into v_start, v_end
    from payments
   where member_id = p_member_id
     and status = 'paid'
     and payment_type = 'monthly_membership'
     and period_end is not null;

  select status into v_status from members where id = p_member_id;

  update members
     set membership_start  = v_start,
         membership_end    = v_end,
         next_payment_date = case when v_end is not null then v_end + 1 end,
         status = case
           -- Administrative holds win over the payment history.
           when v_status in ('suspended', 'inactive') then v_status
           when v_end is not null and v_end >= current_date then 'active'::member_status
           when v_end is not null then 'expired'::member_status
           else v_status
         end,
         updated_at = now()
   where id = p_member_id;
end;
$$;

create or replace function public.payments_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_member_membership(coalesce(new.member_id, old.member_id));
  return coalesce(new, old);
end;
$$;

-- Fills period_start/period_end for membership payments when the caller omits them.
create or replace function public.payments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_type = 'monthly_membership' and new.period_start is null then
    new.period_start := next_period_start(new.member_id, new.payment_date);
  end if;

  if new.period_start is not null and new.period_end is null then
    new.period_end := membership_period_end(new.period_start);
  end if;

  return new;
end;
$$;

-- Financial records are immutable except for status corrections (spec §44).
create or replace function public.payments_guard_update()
returns trigger language plpgsql as $$
begin
  if new.member_id    is distinct from old.member_id
  or new.payment_type is distinct from old.payment_type
  or new.amount       is distinct from old.amount
  or new.payment_date is distinct from old.payment_date then
    raise exception
      'Payment records are immutable. Void this payment and record a corrected one instead.';
  end if;
  return new;
end;
$$;

create or replace function public.payments_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
begin
  select id into v_actor from profiles where user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into financial_audit_logs (payment_id, action, new_value, performed_by)
    values (new.id, 'created', to_jsonb(new), coalesce(new.recorded_by, v_actor));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into financial_audit_logs (payment_id, action, old_value, new_value, performed_by)
    values (new.id, new.status::text, to_jsonb(old), to_jsonb(new), v_actor);
  end if;

  return new;
end;
$$;

-- Every manual membership-status change is recorded (spec §41).
create or replace function public.members_audit_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_data, new_data)
    values (
      auth.uid(), 'status_change', 'member', new.id::text,
      jsonb_build_object('status', old.status, 'membership_id', old.membership_id),
      jsonb_build_object('status', new.status, 'membership_id', new.membership_id, 'reason', new.notes)
    );
  end if;

  if new.fingerprint_id is distinct from old.fingerprint_id then
    insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_data, new_data)
    values (
      auth.uid(), 'fingerprint_change', 'member', new.id::text,
      jsonb_build_object('fingerprint_id', old.fingerprint_id, 'device_id', old.fingerprint_device_id),
      jsonb_build_object('fingerprint_id', new.fingerprint_id, 'device_id', new.fingerprint_device_id)
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- access decision

-- Single source of truth for "may this member open the door" (spec §61).
-- Used by the attendance Edge Function and mirrored by the ESP32 offline cache.
create or replace function public.member_access_decision(p_member_id uuid)
returns table (allowed boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  m members%rowtype;
begin
  select * into m from members where id = p_member_id;

  if not found then
    return query select false, 'MEMBER_NOT_FOUND';
  elsif m.status = 'suspended' then
    return query select false, 'MEMBERSHIP_SUSPENDED';
  elsif m.status = 'inactive' then
    return query select false, 'MEMBERSHIP_INACTIVE';
  elsif m.membership_end is null then
    return query select false, 'NO_MEMBERSHIP';
  elsif m.membership_end < current_date then
    return query select false, 'MEMBERSHIP_EXPIRED';
  else
    return query select true, 'OK';
  end if;
end;
$$;

-- Nightly job (pg_cron) flips lapsed members to `expired`.
create or replace function public.expire_lapsed_memberships()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update members
     set status = 'expired', updated_at = now()
   where status = 'active'
     and membership_end is not null
     and membership_end < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- membership id

-- Allocates the next NOVA-00001 style identifier (spec §39).
create or replace function public.next_membership_id()
returns text
language sql stable security definer set search_path = public as $$
  select 'NOVA-' || lpad((
    coalesce(max(nullif(regexp_replace(membership_id, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 5, '0')
  from members
  where membership_id ~ '^NOVA-\d+$';
$$;

-- ---------------------------------------------------------------- triggers

create trigger profiles_touch          before update on profiles           for each row execute function touch_updated_at();
create trigger members_touch           before update on members            for each row execute function touch_updated_at();
create trigger devices_touch           before update on devices            for each row execute function touch_updated_at();
create trigger workout_plans_touch     before update on workout_plans      for each row execute function touch_updated_at();
create trigger meal_plans_touch        before update on meal_plans         for each row execute function touch_updated_at();
create trigger broadcasts_touch        before update on broadcast_messages for each row execute function touch_updated_at();
create trigger payments_touch          before update on payments           for each row execute function touch_updated_at();

create trigger payments_defaults       before insert on payments for each row execute function payments_before_insert();
create trigger payments_immutable      before update on payments for each row execute function payments_guard_update();
create trigger payments_audit_trg      after insert or update on payments for each row execute function payments_audit();
create trigger payments_recompute      after insert or update or delete on payments
  for each row execute function payments_after_change();

create trigger members_audit_trg       after update on members for each row execute function members_audit_status();

-- ---------------------------------------------------------------- new auth users

-- Magic-link sign-ups land here. They get role `user` and, if their email matches a
-- member record the gym pre-created, the member row is linked automatically.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email, role, full_name)
  values (
    new.id,
    new.email,
    'user',
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;

  update members
     set user_id = new.id, updated_at = now()
   where user_id is null
     and lower(email) = lower(new.email);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
