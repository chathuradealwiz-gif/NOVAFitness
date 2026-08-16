-- NOVA FITNESS — membership IDs are plain numbers
--
-- The gym's member numbers are just digits (34, 56, 789, 1500), not a prefixed
-- code. Converts existing values, normalises leading zeros, and enforces the
-- format from here on.
--
-- The membership number is still the gym's official identifier and stays
-- completely separate from the fingerprint sensor slot (spec §39).

-- 1. Strip everything but digits, then drop leading zeros: NOVA-00037 -> 37.
--    The UNIQUE index on membership_id will raise loudly if two old values
--    collapse onto the same number, rather than silently merging two members.
update members
   set membership_id = coalesce(
         nullif(ltrim(regexp_replace(membership_id, '\D', '', 'g'), '0'), ''),
         '0'
       )
 where membership_id !~ '^[1-9]\d*$';

-- 2. Digits only, no leading zeros, so "034" and "34" can never be two members.
alter table members
  add constraint members_membership_id_numeric_ck
  check (membership_id ~ '^[1-9]\d*$');

-- 3. Next free number: max + 1, as plain digits.
create or replace function public.next_membership_id()
returns text
language sql stable security definer set search_path = public as $$
  select (
    coalesce(max(membership_id::bigint), 0) + 1
  )::text
  from members
  where membership_id ~ '^[1-9]\d*$';
$$;

-- 4. Member self-signup: normalise what the member types before matching, so
--    entering "0034" finds member 34 instead of creating a duplicate.
create or replace function public.claim_membership(
  p_membership_id text,
  p_full_name     text,
  p_phone         text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_email   text;
  v_id      text;
  m         members%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into m from members where user_id = v_user_id;
  if found then
    return jsonb_build_object('status', 'already_linked', 'member_id', m.id);
  end if;

  v_id := nullif(ltrim(regexp_replace(coalesce(p_membership_id, ''), '\D', '', 'g'), '0'), '');
  if v_id is null then
    raise exception 'Enter your membership number.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select * into m from members where membership_id = v_id;

  if found then
    if m.user_id is not null then
      -- Someone already holds this number; do not leak who.
      return jsonb_build_object('status', 'taken');
    end if;

    update members
       set user_id    = v_user_id,
           full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
           phone      = coalesce(nullif(trim(p_phone), ''), phone),
           email      = coalesce(email, v_email),
           updated_at = now()
     where id = m.id;

    return jsonb_build_object('status', 'claimed', 'member_id', m.id);
  end if;

  -- Unknown number: create a record for reception to verify. Starts `inactive`,
  -- so signing up alone grants no door access.
  insert into members (user_id, membership_id, full_name, phone, email, status)
  values (v_user_id, v_id, trim(p_full_name), trim(p_phone), v_email, 'inactive')
  returning * into m;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, new_data)
  values (
    v_user_id, 'self_signup', 'member', m.id::text,
    jsonb_build_object('membership_id', m.membership_id, 'pending_verification', true)
  );

  return jsonb_build_object('status', 'created', 'member_id', m.id);
end;
$$;

-- 5. Search: an all-digits query should match the membership number exactly first,
--    then as a partial, and also check the fingerprint slot (spec §59).
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
     -- Exact membership number first: it is the official gym identifier.
     (m.membership_id = p_query) desc,
     length(m.membership_id),
     m.full_name
   limit p_limit;
end;
$$;
