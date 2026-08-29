-- NOVA FITNESS — emergency contact is no longer collected
--
-- The field is removed from the member profile form and the admin member form.
-- The COLUMN is intentionally kept: dropping it would destroy whatever the gym
-- already captured, and re-adding it later is trivial. It is simply no longer
-- written or displayed.
--
-- update_own_member_profile() previously wrote `emergency_contact` on every call,
-- so once the form stopped sending it every save would have silently blanked the
-- stored value. Optional fields now only change when a value is actually passed.

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
     set full_name = trim(p_full_name),
         phone     = nullif(trim(coalesce(p_phone, '')), ''),
         -- No longer sent by any form, so NULL means "not supplied": keep what is
         -- already stored rather than blanking it.
         emergency_contact = coalesce(nullif(trim(coalesce(p_emergency_contact, '')), ''),
                                      emergency_contact),
         -- Still an editable field, so an empty value must genuinely clear it.
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
