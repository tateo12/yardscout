-- Yardscout migration 2: single-session, flag-wrong-lot, and realtime.
-- Safe to re-run (idempotent). Apply in the Supabase SQL editor.

-- 1. single session per user (the device currently signed in)
alter table profiles add column if not exists active_session uuid;

-- 2. flag-wrong-lot: a rep's on-site correction of a parcel's fit verdict, shared across the crew.
--    one row per parcel per org; 'fits' or 'no_fit' overrides the computed green/yellow/red for everyone.
create table if not exists parcel_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parcel_id text not null,
  verdict text check (verdict in ('fits','no_fit')),
  note text,
  flagged_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, parcel_id)
);
create index if not exists parcel_flags_org_idx on parcel_flags(org_id);

alter table parcel_flags enable row level security;
drop policy if exists pf_select on parcel_flags;
create policy pf_select on parcel_flags for select using (org_id = app_org_id() and app_org_active());
drop policy if exists pf_insert on parcel_flags;
create policy pf_insert on parcel_flags for insert with check (org_id = app_org_id() and app_org_active());
drop policy if exists pf_update on parcel_flags;
create policy pf_update on parcel_flags for update using (org_id = app_org_id() and app_org_active()) with check (org_id = app_org_id() and app_org_active());

-- 3. realtime for shared data + the single-session signal.
--    add each table independently so an already-published table doesn't abort the rest.
do $$ begin alter publication supabase_realtime add table profiles;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table customers;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table knocks;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table parcel_flags; exception when duplicate_object then null; end $$;
