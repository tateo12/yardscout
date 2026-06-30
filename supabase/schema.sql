-- Yardscout Phase 1a schema: orgs (dealers) -> profiles (rep seats), shared customers/knocks, RLS.
-- Apply in the Supabase SQL editor. Security model: the frontend is public, so EVERYTHING is enforced
-- here in Postgres/RLS. Risky writes (org create, invite accept) go through SECURITY DEFINER functions.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing','active','past_due','paused','canceled')),
  plan text not null default 'founding' check (plan in ('founding','standard')),
  seats int not null default 1,
  founding_until date,
  stripe_customer_id text,
  disclaimer_version int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null default 'rep' check (role in ('owner','rep')),
  name text,
  disclaimer_accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists profiles_org_idx on profiles(org_id);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parcel_id text,
  status text,                       -- lead | interested | booked
  name text, phone text, email text,
  addr text, city text,
  method text, place_date date, price numeric, notes text,
  lat double precision, lng double precision,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists customers_org_idx on customers(org_id);

create table if not exists knocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parcel_id text not null,
  outcome text,
  notes text,
  lat double precision, lng double precision,
  knocked_by uuid references auth.users(id),
  knocked_at timestamptz not null default now()
);
create index if not exists knocks_org_idx on knocks(org_id);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  token uuid not null default gen_random_uuid(),
  role text not null default 'rep' check (role in ('owner','rep')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);
create index if not exists invites_token_idx on invites(token);

-- ---------- helpers (SECURITY DEFINER avoids RLS recursion on profiles) ----------
create or replace function app_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
    select org_id from profiles where id = auth.uid();
$$;

create or replace function app_is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from profiles where id = auth.uid() and role = 'owner');
$$;

-- the access gate, enforced in the DB: data is reachable only when the org is paying/trialing
create or replace function app_org_active() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from orgs o join profiles p on p.org_id = o.id
      where p.id = auth.uid() and o.subscription_status in ('trialing','active')
    );
$$;

-- ---------- RLS ----------
alter table orgs      enable row level security;
alter table profiles  enable row level security;
alter table customers enable row level security;
alter table knocks    enable row level security;
alter table invites   enable row level security;

-- one policy per line (paste-proof), with drop-if-exists so the whole script is safe to re-run.
drop policy if exists orgs_select on orgs;
create policy orgs_select on orgs for select using (id = app_org_id());
drop policy if exists orgs_update on orgs;
create policy orgs_update on orgs for update using (id = app_org_id() and app_is_owner()) with check (id = app_org_id());

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (org_id = app_org_id());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists customers_select on customers;
create policy customers_select on customers for select using (org_id = app_org_id() and app_org_active());
drop policy if exists customers_insert on customers;
create policy customers_insert on customers for insert with check (org_id = app_org_id() and app_org_active());
drop policy if exists customers_update on customers;
create policy customers_update on customers for update using (org_id = app_org_id() and app_org_active()) with check (org_id = app_org_id());

drop policy if exists knocks_select on knocks;
create policy knocks_select on knocks for select using (org_id = app_org_id() and app_org_active());
drop policy if exists knocks_insert on knocks;
create policy knocks_insert on knocks for insert with check (org_id = app_org_id() and app_org_active());
drop policy if exists knocks_update on knocks;
create policy knocks_update on knocks for update using (org_id = app_org_id() and app_org_active()) with check (org_id = app_org_id());

drop policy if exists invites_owner_select on invites;
create policy invites_owner_select on invites for select using (org_id = app_org_id() and app_is_owner());
drop policy if exists invites_owner_insert on invites;
create policy invites_owner_insert on invites for insert with check (org_id = app_org_id() and app_is_owner());

-- ---------- RPCs for the risky write paths ----------
-- owner signs up -> creates their org + their own owner profile (90-day founding window)
create or replace function create_org(org_name text, owner_name text)
  returns uuid language plpgsql security definer set search_path = public as $$
  declare new_org uuid;
  begin
    if auth.uid() is null then raise exception 'must be signed in'; end if;
    if exists (select 1 from profiles where id = auth.uid()) then raise exception 'already in an org'; end if;
    insert into orgs(name, subscription_status, founding_until)
      values (org_name, 'trialing', (now() + interval '90 days')::date)
      returning id into new_org;
    insert into profiles(id, org_id, role, name) values (auth.uid(), new_org, 'owner', owner_name);
    return new_org;
  end; $$;

-- rep accepts an emailed invite -> joins the org as a seat
create or replace function accept_invite(invite_token uuid, member_name text)
  returns uuid language plpgsql security definer set search_path = public as $$
  declare inv invites;
  begin
    if auth.uid() is null then raise exception 'must be signed in'; end if;
    select * into inv from invites where token = invite_token and accepted_at is null and expires_at > now();
    if inv.id is null then raise exception 'invalid or expired invite'; end if;
    if exists (select 1 from profiles where id = auth.uid()) then raise exception 'already in an org'; end if;
    insert into profiles(id, org_id, role, name) values (auth.uid(), inv.org_id, inv.role, member_name);
    update invites set accepted_at = now() where id = inv.id;
    return inv.org_id;
  end; $$;

-- record the one-time disclaimer acceptance
create or replace function accept_disclaimer(version int)
  returns void language plpgsql security definer set search_path = public as $$
  begin
    update profiles set disclaimer_accepted_at = now() where id = auth.uid();
  end; $$;
