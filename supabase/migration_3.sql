-- Yardscout CRM depth: per-customer activity timeline + follow-up scheduling.
-- Apply in the Supabase SQL editor. Safe to re-run (idempotent). The frontend degrades gracefully
-- until this is applied (activity/follow-up writes fail quietly; core customer saves are unaffected).

-- follow-up scheduling on the existing customer row
alter table customers add column if not exists next_follow_up date;
alter table customers add column if not exists follow_up_note text;

-- activity timeline: one row per logged touch (call/text/knock/meeting/note) on a customer
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null,                 -- call | text | knock | meeting | note
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists activities_org_idx on activities(org_id);
create index if not exists activities_customer_idx on activities(customer_id);

-- realtime for cross-rep updates
do $$ begin
  alter publication supabase_realtime add table activities;
exception when duplicate_object then null; end $$;

-- RLS: same org + active-subscription gate as customers/knocks
alter table activities enable row level security;
drop policy if exists activities_select on activities;
create policy activities_select on activities for select using (org_id = app_org_id() and app_org_active());
drop policy if exists activities_insert on activities;
create policy activities_insert on activities for insert with check (org_id = app_org_id() and app_org_active());
drop policy if exists activities_delete on activities;
create policy activities_delete on activities for delete using (org_id = app_org_id() and app_org_active());
