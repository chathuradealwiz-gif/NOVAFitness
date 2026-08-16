-- NOVA FITNESS — storage buckets, aggregate RPCs and seed data

-- ---------------------------------------------------------------- storage (spec §38)

-- Private bucket: member photos are personal data, served through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images', 'profile-images', false, 2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Public bucket: gym logo and other branding (spec §36).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding', 'branding', true, 2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Private bucket: uploaded workout PDFs/images (spec §51).
insert into storage.buckets (id, name, public, file_size_limit)
values ('workout-files', 'workout-files', false, 10 * 1024 * 1024)
on conflict (id) do nothing;

-- Objects are namespaced by the owner's auth uid: profile-images/<uid>/avatar.jpg
create policy "profile images are readable by owner"
  on storage.objects for select
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile images are readable by staff"
  on storage.objects for select
  using (bucket_id = 'profile-images' and public.is_staff());

create policy "members manage their own profile image"
  on storage.objects for all
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "branding is world readable"
  on storage.objects for select using (bucket_id = 'branding');

create policy "staff manage branding"
  on storage.objects for all
  using (bucket_id = 'branding' and public.is_staff())
  with check (bucket_id = 'branding' and public.is_staff());

create policy "staff manage workout files"
  on storage.objects for all
  using (bucket_id = 'workout-files' and public.is_staff())
  with check (bucket_id = 'workout-files' and public.is_staff());

create policy "members read their own workout files"
  on storage.objects for select
  using (bucket_id = 'workout-files' and exists (
    select 1
      from workout_files f
      join workout_plans p on p.id = f.workout_plan_id
     where f.file_path = storage.objects.name
       and p.member_id = public.current_member_id()
  ));

-- ---------------------------------------------------------------- dashboard RPCs
-- Aggregated server-side so Vercel/the browser never pulls whole tables (spec
-- "Vercel Free Hosting").

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
    'total_members',    (select count(*) from members),
    'active_members',   (select count(*) from members where status = 'active'),
    'expired_members',  (select count(*) from members where status = 'expired'),
    'suspended_members',(select count(*) from members where status = 'suspended'),
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
                          where next_payment_date between current_date and current_date + 7)
  ) into result;

  return result;
end;
$$;

-- 14-day attendance trend for the dashboard chart.
create or replace function public.attendance_trend(p_days integer default 14)
returns table (day date, entries bigint, exits bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select d::date as day,
         count(*) filter (where a.event_type = 'entry') as entries,
         count(*) filter (where a.event_type = 'exit')  as exits
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
    left join attendance a
      on a.occurred_at >= d and a.occurred_at < d + interval '1 day' and a.authorized
   group by d
   order by d;
end;
$$;

-- Monthly financial report, broken down by payment type (spec §47, §63).
create or replace function public.financial_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'total', coalesce(sum(type_total), 0),
    -- jsonb_object_agg needs text keys, and payment_type is an enum.
    'by_type', coalesce(jsonb_object_agg(payment_type::text, type_total), '{}'::jsonb)
  )
  into result
  from (
    select payment_type, sum(amount) as type_total
      from payments
     where status = 'paid' and payment_date between p_from and p_to
     group by payment_type
  ) t;

  return coalesce(result, jsonb_build_object('from', p_from, 'to', p_to,
                                             'total', 0, 'by_type', '{}'::jsonb));
end;
$$;

-- Daily revenue series for the finance chart.
create or replace function public.revenue_trend(p_from date, p_to date)
returns table (day date, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select d::date, coalesce(sum(p.amount), 0)
    from generate_series(p_from, p_to, interval '1 day') d
    left join payments p on p.payment_date = d::date and p.status = 'paid'
   group by d
   order by d;
end;
$$;

-- Fast global member search across every identifier in spec §59.
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
   where m.membership_id ilike '%' || p_query || '%'
      or m.full_name     ilike '%' || p_query || '%'
      or m.phone         ilike '%' || p_query || '%'
      or m.email         ilike '%' || p_query || '%'
      or (p_query ~ '^\d+$' and m.fingerprint_id = p_query::integer)
   order by
     -- Exact membership-ID hits first: it is the official gym identifier.
     (lower(m.membership_id) = lower(p_query)) desc,
     m.full_name
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------- seed

insert into gym_settings (gym_name, currency, monthly_membership_fee, registration_fee)
values ('NOVA FITNESS', 'LKR', 0, 0)
on conflict (singleton) do nothing;
