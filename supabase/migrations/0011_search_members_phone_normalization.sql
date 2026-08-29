-- Phone-number normalisation for member search (spec §11 of the Pay page brief).
--
-- Members are entered with whatever format the front desk typed: 0771234567,
-- +94771234567, 077 123 4567. Searching for one format must find the others, so
-- both sides of the comparison are reduced to their last 9 significant digits —
-- the part of a Sri Lankan mobile number that is invariant across formats:
--
--   0771234567    -> 771234567
--   +94771234567  -> 771234567
--   077 123 4567  -> 771234567
--
-- Everything else about search_members is unchanged: same signature, same
-- is_staff() guard, same ranking. Only the phone branch is widened.

create or replace function public.normalize_phone(p_phone text)
returns text
language sql immutable as $$
  -- Strip to digits, then keep the trailing 9. Shorter numbers are returned as-is
  -- so landlines and partial input still compare sensibly.
  select case
    when p_phone is null then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
      then right(regexp_replace(p_phone, '\D', '', 'g'), 9)
    else regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;

create or replace function public.search_members(p_query text, p_limit integer default 20)
returns setof members
language plpgsql stable security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
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
      -- Format-insensitive phone match. Guarded at 7+ digits so that short
      -- numeric queries stay membership-number searches rather than matching
      -- half the gym on a common phone fragment.
      or (
        length(v_digits) >= 7
        and normalize_phone(m.phone) like '%' || right(v_digits, 9) || '%'
      )
   order by
     -- Exact membership number first: it is the official gym identifier.
     (m.membership_id = p_query) desc,
     length(m.membership_id),
     m.full_name
   limit p_limit;
end;
$$;

grant execute on function public.normalize_phone(text) to authenticated, service_role;
