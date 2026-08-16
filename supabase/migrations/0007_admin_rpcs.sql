-- NOVA FITNESS — staff actions that must write audit rows
--
-- audit_logs and financial_audit_logs deliberately have no client INSERT/UPDATE
-- policy, so nothing writable from the browser can forge an audit trail. That
-- means staff actions which *should* leave an audit entry cannot do it with a
-- plain insert — they go through these SECURITY DEFINER functions, which check the
-- caller's role first and then write both the change and its audit row atomically.

-- Manual membership status override (spec §41). Reason is mandatory.
create or replace function public.change_member_status(
  p_member_id uuid,
  p_status    member_status,
  p_reason    text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old member_status;
  v_membership_id text;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required for a manual status change.';
  end if;

  select status, membership_id into v_old, v_membership_id
    from members where id = p_member_id;

  if not found then
    raise exception 'member_not_found';
  end if;

  update members set status = p_status, updated_at = now() where id = p_member_id;

  insert into audit_logs (
    actor_user_id, action, entity_type, entity_id, old_data, new_data, reason
  )
  values (
    auth.uid(), 'manual_status_change', 'member', p_member_id::text,
    jsonb_build_object('status', v_old, 'membership_id', v_membership_id),
    jsonb_build_object('status', p_status, 'membership_id', v_membership_id),
    trim(p_reason)
  );

  return jsonb_build_object('previous', v_old, 'current', p_status);
end;
$$;

-- Void or refund a payment (spec §44, §48). Super admin only; the row is never
-- deleted and the reason lands in the financial audit log.
create or replace function public.void_payment(
  p_payment_id uuid,
  p_status     payment_status,
  p_reason     text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member_id uuid;
  v_old       payments%rowtype;
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_status not in ('voided', 'refunded') then
    raise exception 'invalid_status';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to void or refund a payment.';
  end if;

  select * into v_old from payments where id = p_payment_id;
  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_old.status <> 'paid' then
    raise exception 'Only a paid payment can be voided or refunded.';
  end if;

  update payments set status = p_status where id = p_payment_id
  returning member_id into v_member_id;

  -- The payments_audit trigger already inserted the status-change row; attach the
  -- reason to it rather than writing a second, duplicate entry.
  update financial_audit_logs
     set reason = trim(p_reason)
   where payment_id = p_payment_id
     and action = p_status::text
     and reason is null;

  return jsonb_build_object('member_id', v_member_id);
end;
$$;

-- Grant or revoke admin rights (spec §65). Super admin only.
create or replace function public.set_user_role(
  p_profile_id uuid,
  p_role       user_role
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target profiles%rowtype;
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_role not in ('admin', 'user') then
    raise exception 'Only admin and user roles can be assigned here.';
  end if;

  select * into v_target from profiles where id = p_profile_id;
  if not found then
    raise exception 'profile_not_found';
  end if;

  -- Lock-out guards: never demote yourself, never demote another super admin.
  if v_target.user_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;
  if v_target.role = 'super_admin' then
    raise exception 'Super admin accounts cannot be demoted here.';
  end if;

  update profiles set role = p_role where id = p_profile_id;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    auth.uid(), 'role_change', 'profile', p_profile_id::text,
    jsonb_build_object('role', v_target.role, 'email', v_target.email),
    jsonb_build_object('role', p_role, 'email', v_target.email)
  );

  return jsonb_build_object('role', p_role);
end;
$$;

-- Enable or disable a staff account, with an audit entry.
create or replace function public.set_profile_active(
  p_profile_id uuid,
  p_is_active  boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target profiles%rowtype;
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_target from profiles where id = p_profile_id;
  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'You cannot disable your own account.';
  end if;

  update profiles set is_active = p_is_active where id = p_profile_id;

  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    auth.uid(),
    case when p_is_active then 'account_enabled' else 'account_disabled' end,
    'profile', p_profile_id::text,
    jsonb_build_object('is_active', v_target.is_active),
    jsonb_build_object('is_active', p_is_active)
  );

  return jsonb_build_object('is_active', p_is_active);
end;
$$;

revoke all on function public.change_member_status(uuid, member_status, text) from public;
revoke all on function public.void_payment(uuid, payment_status, text)        from public;
revoke all on function public.set_user_role(uuid, user_role)                  from public;
revoke all on function public.set_profile_active(uuid, boolean)               from public;

grant execute on function public.change_member_status(uuid, member_status, text) to authenticated;
grant execute on function public.void_payment(uuid, payment_status, text)        to authenticated;
grant execute on function public.set_user_role(uuid, user_role)                  to authenticated;
grant execute on function public.set_profile_active(uuid, boolean)               to authenticated;
