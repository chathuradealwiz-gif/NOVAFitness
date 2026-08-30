-- Unassigning a fingerprint must erase the template, not just the mapping.
--
-- Until now removeFingerprint() nulled members.fingerprint_id and
-- fingerprint_device_id and queued nothing, on the stated assumption that an
-- unassign is usually a re-enrollment that would reuse the slot. It is not:
-- the terminal picks the next FREE slot at enrollment (free_slot() in
-- main.py), so the old template is never overwritten. It stayed in the R503's
-- flash forever and the slot was burned.
--
-- Worse, it stranded the delete path. delete_member_permanently only queues an
-- erasure while the member still names a slot; once unassigned, that number is
-- gone from the database entirely, so deleting the profile afterwards left the
-- biometric template on the device with nothing left to point at it — the one
-- case where it must not survive.
--
-- The slot number only exists before the columns are cleared, so the erasure
-- has to be queued in the same statement that clears them.

create or replace function public.unassign_fingerprint(p_member_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m        record;
  v_actor  uuid;
  v_queued boolean := false;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, fingerprint_id, fingerprint_device_id into m
    from members where id = p_member_id;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  if m.fingerprint_id is null or m.fingerprint_device_id is null then
    return jsonb_build_object('status', 'not_assigned', 'fingerprint_queued', false);
  end if;

  select id into v_actor from profiles where user_id = auth.uid();

  -- Queue before clearing: after the update the slot number is unrecoverable.
  -- on conflict do nothing — the partial unique index means re-requesting an
  -- outstanding erasure is a no-op rather than a duplicate row.
  insert into fingerprint_erasures (device_id, fingerprint_id, member_id, requested_by)
  values (m.fingerprint_device_id, m.fingerprint_id, m.id, v_actor)
  on conflict do nothing;
  v_queued := true;

  update members
     set fingerprint_id        = null,
         fingerprint_device_id = null,
         updated_at            = now()
   where id = p_member_id;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, new_data)
  values (
    auth.uid(), 'fingerprint_unassigned', 'member', p_member_id::text,
    jsonb_build_object('fingerprint_id', m.fingerprint_id, 'fingerprint_queued', v_queued)
  );

  return jsonb_build_object('status', 'unassigned', 'fingerprint_queued', v_queued);
end;
$$;

revoke all on function public.unassign_fingerprint(uuid) from public;
grant execute on function public.unassign_fingerprint(uuid) to authenticated;
