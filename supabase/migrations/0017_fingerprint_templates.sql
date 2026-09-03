-- Off-device backup of the biometric templates.
--
-- Until now the sensor's own flash held the only copy of every member's
-- fingerprint. A template cannot be recomputed from anything else in this
-- database, so a dead module meant all ~500 members returning to the desk to
-- enrol again — days of staff time and a gym that cannot open its door.
--
-- The device uploads the template it just enrolled, and can pull them all back
-- into a replacement sensor. Restoring 500 is a couple of minutes of UART
-- traffic; re-enrolling 500 is a fortnight.
--
-- What this is NOT: matching data. The blob is the vendor's own feature
-- encoding, not ISO 19794-2, and nothing here or in the app can interpret it.
-- It is only ever handed back to a sensor of the same family — which is why
-- `sensor_model` is stored beside it. An optical R307 template is meaningless
-- to a capacitive R503 and vice versa, so a restore onto the wrong family must
-- be refused rather than written and left to fail at the first scan.

create table if not exists fingerprint_templates (
  member_id    uuid primary key references members (id) on delete cascade,
  device_id    uuid not null references devices (id) on delete cascade,
  -- The slot the template occupied when it was captured. Kept as a hint for
  -- restores, not as identity: after a rebuild the same member may land
  -- elsewhere, and members.fingerprint_id stays the authority.
  fingerprint_id integer not null,
  -- "R307", "R503". A restore onto a different family is refused.
  sensor_model text not null,
  template     bytea not null,
  byte_len     integer not null check (byte_len > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists fingerprint_templates_device_idx
  on fingerprint_templates (device_id);

-- Biometric data: no client of any role reads this table. RLS is enabled with
-- no policy at all, so PostgREST returns nothing to anon, authenticated or a
-- signed-in admin. Only the Edge Functions reach it, on the service-role key,
-- and only to serve the device that enrolled it.
alter table fingerprint_templates enable row level security;

-- Staff do need to know whether a member is protected, which is a boolean, not
-- a template. This view carries no bytes.
create or replace view fingerprint_backup_status
with (security_invoker = true) as
  select m.id            as member_id,
         m.membership_id,
         m.full_name,
         m.fingerprint_id,
         (t.member_id is not null) as backed_up,
         t.sensor_model,
         t.updated_at    as backed_up_at
    from members m
    left join fingerprint_templates t on t.member_id = m.id
   where m.fingerprint_id is not null;

grant select on fingerprint_backup_status to authenticated;

-- Erasing a member must erase the backup too. The template is deleted by the
-- cascade above when the member row goes, but unassigning a fingerprint leaves
-- the member in place — and a backup outliving its mapping is a fingerprint the
-- gym still holds for someone it no longer has a slot for.
create or replace function public.drop_template_on_unassign()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fingerprint_id is null and old.fingerprint_id is not null then
    delete from fingerprint_templates where member_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists members_drop_template on members;
create trigger members_drop_template
  after update of fingerprint_id on members
  for each row execute function public.drop_template_on_unassign();
