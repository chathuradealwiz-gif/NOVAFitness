-- NOVA FITNESS — member self-signup (spec §40, §69)
--
-- A signed-in magic-link user claims the member record matching their NOVA
-- Membership ID. RLS deliberately forbids updating a row you do not own yet, so
-- the claim runs through this SECURITY DEFINER function instead.
--
-- Trust model: possession of the membership ID is only a weak claim, so a claimed
-- record is never activated here. Activation stays with an admin recording a
-- payment (spec §69: "Admin verifies/activates membership").

create or replace function public.claim_membership(
  p_membership_id text,
  p_full_name     text,
  p_phone         text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id  uuid := auth.uid();
  v_email    text;
  m          members%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Already linked to a member? Nothing to do.
  select * into m from members where user_id = v_user_id;
  if found then
    return jsonb_build_object('status', 'already_linked', 'member_id', m.id);
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select * into m
    from members
   where upper(membership_id) = upper(trim(p_membership_id));

  if found then
    if m.user_id is not null then
      -- Someone already holds this ID; do not leak who.
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

  -- No such ID on file: create a record for reception to verify. It starts
  -- `inactive`, so no door access is granted by signing up.
  insert into members (user_id, membership_id, full_name, phone, email, status)
  values (
    v_user_id,
    upper(trim(p_membership_id)),
    trim(p_full_name),
    trim(p_phone),
    v_email,
    'inactive'
  )
  returning * into m;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, new_data)
  values (
    v_user_id, 'self_signup', 'member', m.id::text,
    jsonb_build_object('membership_id', m.membership_id, 'pending_verification', true)
  );

  return jsonb_build_object('status', 'created', 'member_id', m.id);
end;
$$;

revoke all on function public.claim_membership(text, text, text) from public;
grant execute on function public.claim_membership(text, text, text) to authenticated;

-- Members edit their own contact details here rather than through an RLS UPDATE
-- policy, because RLS cannot restrict which columns a statement writes. Only these
-- four columns are ever touched: status, membership_id, fingerprint and membership
-- dates stay under staff control.
create or replace function public.update_own_member_profile(
  p_full_name         text,
  p_phone             text,
  p_emergency_contact text default null,
  p_address           text default null,
  p_profile_image_url text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'invalid_name';
  end if;

  update members
     set full_name         = trim(p_full_name),
         phone             = nullif(trim(coalesce(p_phone, '')), ''),
         emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
         address           = nullif(trim(coalesce(p_address, '')), ''),
         profile_image_url = coalesce(p_profile_image_url, profile_image_url),
         updated_at        = now()
   where user_id = v_user_id
  returning id into v_id;

  if v_id is null then
    raise exception 'no_member_record';
  end if;

  return jsonb_build_object('member_id', v_id);
end;
$$;

revoke all on function public.update_own_member_profile(text, text, text, text, text) from public;
grant execute on function public.update_own_member_profile(text, text, text, text, text) to authenticated;
