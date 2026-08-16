-- NOVA FITNESS — fix: a paid membership must activate the member
--
-- Bug: recompute_member_membership() treated BOTH 'suspended' and 'inactive' as
-- administrative holds that the payment history must not override. But members are
-- created with status 'inactive', so a brand-new member who paid kept the correct
-- period while their status stayed 'inactive' — and member_access_decision() denies
-- 'inactive', so the door would have refused every paying member.
--
-- Spec §61: "Payment recorded -> New active membership period -> Access
-- automatically authorized." Only 'suspended' is a deliberate hold that outranks
-- the payment history; 'inactive' means "not yet activated / lapsed", which a
-- payment is precisely meant to clear.

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
           -- A suspension is a deliberate administrative hold: paying does not
           -- lift it. Staff must un-suspend explicitly.
           when v_status = 'suspended' then 'suspended'::member_status
           -- Otherwise the paid period is the source of truth, which is what
           -- reactivates a new or lapsed member.
           when v_end is not null and v_end >= current_date then 'active'::member_status
           when v_end is not null then 'expired'::member_status
           else v_status
         end,
         updated_at = now()
   where id = p_member_id;
end;
$$;

-- Backfill: repair anyone already stuck inactive despite a paid, current period.
do $$
declare
  r record;
begin
  for r in select id from members loop
    perform recompute_member_membership(r.id);
  end loop;
end;
$$;
