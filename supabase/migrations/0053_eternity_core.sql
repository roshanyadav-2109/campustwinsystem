-- Eternity Core: the shared platform under every Eternity product.
--
-- Holds who the customers are (organisations), what they have bought
-- (subscriptions to products and plans), who belongs to them (memberships and
-- which products each member may open) and an append-only audit log.
--
-- Rules:
--   * Lives in its own schema. Products keep their own data in their own schema
--     (CampusTwin is `public` today) and only read core.
--   * Server only. anon and authenticated get no access; the app reads core with
--     the service role. RLS is enabled with no policies as a second lock.
--   * Backfills every existing university, school and login, then keeps itself in
--     sync through triggers, so CampusTwin code that creates schools or profiles
--     does not need to know core exists.
--   * Idempotent: safe to run twice.

begin;

create schema if not exists core;

-- ------------------------------------------------------------ helpers
create or replace function core.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------ organisations
-- One row per customer. A university with many campuses is one organisation;
-- a trust running several schools can group them through parent_id.
create table if not exists core.organisation (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 200),
  slug          text unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  kind          text not null default 'school'
                  check (kind in ('school', 'college', 'university', 'business', 'trust', 'other')),
  parent_id     uuid references core.organisation(id) on delete set null,
  legal_name    text,
  gstin         text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan           text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  billing_email text,
  phone         text,
  address       text,
  state         text,
  country       text not null default 'IN',
  status        text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
drop trigger if exists organisation_touch on core.organisation;
create trigger organisation_touch before update on core.organisation
  for each row execute function core.touch_updated_at();

-- ------------------------------------------------------------ products and plans
create table if not exists core.product (
  code       text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text not null,
  unit       text not null check (unit in ('student', 'employee', 'organisation', 'user')),
  status     text not null default 'planned' check (status in ('live', 'beta', 'planned', 'retired')),
  sort       smallint not null default 100,
  created_at timestamptz not null default now()
);

insert into core.product (code, name, unit, status, sort) values
  ('campustwin', 'CampusTwin',       'student',      'live',    10),
  ('hr',         'Eternity HR',      'employee',     'planned', 20),
  ('finance',    'Eternity Finance', 'organisation', 'planned', 30),
  ('learn',      'Eternity Learn',   'student',      'planned', 40),
  ('desk',       'Eternity Desk',    'user',         'planned', 50),
  ('alumni',     'Eternity Alumni',  'user',         'planned', 35)
on conflict (code) do nothing;

-- Prices are stored in paise per unit per period, so no rounding ever happens.
create table if not exists core.plan (
  id           uuid primary key default gen_random_uuid(),
  product_code text not null references core.product(code) on update cascade,
  code         text not null check (code ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name         text not null,
  price_paise  bigint not null default 0 check (price_paise >= 0),
  period       text not null default 'year' check (period in ('month', 'year')),
  features     jsonb not null default '{}'::jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (product_code, code)
);

-- Today every institution is on the free-text plan "standard"; keep it as a
-- legacy plan with no price until real pricing is set.
insert into core.plan (product_code, code, name, price_paise, period)
values ('campustwin', 'standard', 'Standard', 0, 'year')
on conflict (product_code, code) do nothing;

-- ------------------------------------------------------------ subscriptions
-- What an organisation has bought. At most one live subscription per
-- organisation and product; history stays as cancelled or expired rows.
create table if not exists core.subscription (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references core.organisation(id) on delete cascade,
  product_code       text not null references core.product(code) on update cascade,
  plan_id            uuid references core.plan(id),
  status             text not null default 'active'
                       check (status in ('trial', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  quantity           integer check (quantity is null or quantity >= 0),
  started_at         timestamptz not null default now(),
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  cancelled_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists subscription_one_live
  on core.subscription (org_id, product_code)
  where status in ('trial', 'active', 'past_due', 'paused');
create index if not exists subscription_org on core.subscription (org_id);
drop trigger if exists subscription_touch on core.subscription;
create trigger subscription_touch before update on core.subscription
  for each row execute function core.touch_updated_at();

-- ------------------------------------------------------------ members
-- A person (one Eternity login) belonging to an organisation. `role` is about
-- the organisation itself (owner and admins manage products and billing); what a
-- person may do inside a product stays that product's business.
create table if not exists core.membership (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.organisation(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status     text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists membership_user on core.membership (user_id);
drop trigger if exists membership_touch on core.membership;
create trigger membership_touch before update on core.membership
  for each row execute function core.touch_updated_at();

-- Which products each member may open (drives the product switcher).
create table if not exists core.product_access (
  membership_id uuid not null references core.membership(id) on delete cascade,
  product_code  text not null references core.product(code) on update cascade,
  granted_at    timestamptz not null default now(),
  primary key (membership_id, product_code)
);

-- ------------------------------------------------------------ audit log
-- Append-only record of platform actions (subscriptions changed, organisation
-- suspended, member invited ...). Updates and deletes are refused.
create table if not exists core.audit_event (
  id            bigint generated always as identity primary key,
  org_id        uuid references core.organisation(id) on delete set null,
  product_code  text,
  actor_user_id uuid,
  actor_email   text,
  action        text not null check (action ~ '^[a-z][a-z0-9_.]{1,80}$'),
  entity        text,
  entity_id     text,
  data          jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);
create index if not exists audit_event_org_at on core.audit_event (org_id, at desc);

-- Direct edits are refused. When an organisation is deleted, its events stay
-- and only lose the link (the foreign key's SET NULL runs one trigger level deeper).
create or replace function core.audit_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and new.org_id is null and old.org_id is not null
     and (new.id, new.product_code, new.actor_user_id, new.actor_email, new.action, new.entity, new.entity_id, new.data, new.at)
         is not distinct from (old.id, old.product_code, old.actor_user_id, old.actor_email, old.action, old.entity, old.entity_id, old.data, old.at) then
    return new;
  end if;
  raise exception 'core.audit_event is append-only';
end $$;
drop trigger if exists audit_event_no_change on core.audit_event;
create trigger audit_event_no_change before update or delete on core.audit_event
  for each row execute function core.audit_append_only();

-- ------------------------------------------------------------ links from CampusTwin
alter table public.university add column if not exists org_id uuid references core.organisation(id);
alter table public.school     add column if not exists org_id uuid references core.organisation(id);
create unique index if not exists university_org_id on public.university (org_id) where org_id is not null;
create index if not exists school_org_id on public.school (org_id);

-- ------------------------------------------------------------ reserved addresses
-- Sub-addresses of the base domain used by Eternity itself (products, sign-in,
-- console, files). No school, campus or university may take one.
create table if not exists core.reserved_name (
  name text primary key check (name ~ '^[a-z0-9][a-z0-9-]{0,62}$')
);
insert into core.reserved_name (name) values
  ('www'), ('cdn'), ('console'), ('id'), ('accounts'), ('auth'), ('login'), ('api'), ('status'),
  ('eternity'), ('app'), ('admin'), ('mail'), ('email'), ('help'), ('support'), ('docs'), ('blog'),
  ('static'), ('assets'), ('media'), ('files'),
  ('hr'), ('hrms'), ('finance'), ('books'), ('learn'), ('desk'), ('alumni'), ('campustwin')
on conflict do nothing;

create or replace function core.refuse_reserved_slug() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.slug is not null and exists (select 1 from core.reserved_name r where r.name = lower(new.slug)) then
    raise exception 'The address "%" is reserved for Eternity; choose another', new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists school_reserved_slug on public.school;
create trigger school_reserved_slug before insert or update of slug on public.school
  for each row execute function core.refuse_reserved_slug();
drop trigger if exists university_reserved_slug on public.university;
create trigger university_reserved_slug before insert or update of slug on public.university
  for each row execute function core.refuse_reserved_slug();

-- ------------------------------------------------------------ sync triggers
-- Universities and standalone schools are customers; campuses belong to their
-- university's organisation. New ones get an organisation and a CampusTwin
-- subscription the moment they are created.
create or replace function core.ensure_campustwin_subscription(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into core.subscription (org_id, product_code, plan_id, status)
  select p_org, 'campustwin', p.id, 'active'
  from core.plan p
  where p.product_code = 'campustwin' and p.code = 'standard'
    and not exists (
      select 1 from core.subscription s
      where s.org_id = p_org and s.product_code = 'campustwin'
        and s.status in ('trial', 'active', 'past_due', 'paused'));
$$;

create or replace function core.org_status(p text) returns text
language sql immutable as $$
  select case when p = 'suspended' then 'suspended' else 'active' end
$$;

create or replace function core.university_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.org_id is null then
    insert into core.organisation (name, slug, kind, status)
    values (new.name, new.slug, 'university', core.org_status(new.status))
    returning id into new.org_id;
    perform core.ensure_campustwin_subscription(new.org_id);
  elsif tg_op = 'UPDATE' and new.org_id is not null
        and (new.name, new.slug, new.status) is distinct from (old.name, old.slug, old.status) then
    update core.organisation
       set name = new.name, slug = new.slug, status = core.org_status(new.status)
     where id = new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists university_core_sync on public.university;
create trigger university_core_sync before insert or update on public.university
  for each row execute function core.university_sync();

create or replace function core.school_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.university_id is not null then
    -- a campus: same customer as its university
    if new.org_id is null or (tg_op = 'UPDATE' and new.university_id is distinct from old.university_id) then
      select u.org_id into new.org_id from public.university u where u.id = new.university_id;
    end if;
  elsif tg_op = 'INSERT' and new.org_id is null then
    insert into core.organisation (name, slug, kind, status)
    values (new.name, new.slug, 'school', core.org_status(new.status))
    returning id into new.org_id;
    perform core.ensure_campustwin_subscription(new.org_id);
  elsif tg_op = 'UPDATE' and new.org_id is not null
        and (new.name, new.slug, new.status) is distinct from (old.name, old.slug, old.status)
        and not exists (select 1 from public.school s where s.org_id = new.org_id and s.id <> new.id) then
    -- standalone school: keep its organisation's name and status in step
    update core.organisation
       set name = new.name, slug = new.slug, status = core.org_status(new.status)
     where id = new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists school_core_sync on public.school;
create trigger school_core_sync before insert or update on public.school
  for each row execute function core.school_sync();

-- Every CampusTwin login becomes a member of its institution's organisation
-- with access to CampusTwin.
create or replace function core.profile_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_member uuid;
begin
  select coalesce(
           (select s.org_id from public.school s where s.id = new.school_id),
           (select u.org_id from public.university u where u.id = new.university_id))
    into v_org;
  if v_org is null then
    return new;
  end if;
  insert into core.membership (org_id, user_id)
  values (v_org, new.id)
  on conflict (org_id, user_id) do update set status = core.membership.status
  returning id into v_member;
  insert into core.product_access (membership_id, product_code)
  values (v_member, 'campustwin')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists profile_core_sync on public.profile;
create trigger profile_core_sync after insert or update of school_id, university_id on public.profile
  for each row execute function core.profile_sync();

-- When the last school or university of an organisation is deleted: if the
-- customer has only ever had CampusTwin, the organisation goes too (members and
-- subscriptions cascade); if it also has another product, only the CampusTwin
-- subscription is cancelled and the customer stays.
create or replace function core.release_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_org is null
     or exists (select 1 from public.school s where s.org_id = p_org)
     or exists (select 1 from public.university u where u.org_id = p_org) then
    return;
  end if;
  if exists (select 1 from core.subscription s where s.org_id = p_org and s.product_code <> 'campustwin') then
    update core.subscription
       set status = 'cancelled', cancelled_at = now()
     where org_id = p_org and product_code = 'campustwin'
       and status in ('trial', 'active', 'past_due', 'paused');
  elsif exists (select 1 from core.subscription s where s.org_id = p_org and s.product_code = 'campustwin') then
    delete from core.organisation where id = p_org;
  end if;
end $$;

create or replace function core.entity_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform core.release_org(old.org_id);
  return old;
end $$;
drop trigger if exists school_core_removed on public.school;
create trigger school_core_removed after delete on public.school
  for each row execute function core.entity_removed();
drop trigger if exists university_core_removed on public.university;
create trigger university_core_removed after delete on public.university
  for each row execute function core.entity_removed();

-- ------------------------------------------------------------ backfill
do $$
declare
  r record;
  v_org uuid;
begin
  for r in select id, name, slug, status from public.university where org_id is null order by id loop
    insert into core.organisation (name, slug, kind, status)
    values (r.name, r.slug, 'university', core.org_status(r.status))
    returning id into v_org;
    update public.university set org_id = v_org where id = r.id;
  end loop;

  update public.school s set org_id = u.org_id
    from public.university u
   where s.university_id = u.id and s.org_id is null;

  for r in select id, name, slug, status from public.school
            where university_id is null and org_id is null order by id loop
    insert into core.organisation (name, slug, kind, status)
    values (r.name, r.slug, 'school', core.org_status(r.status))
    returning id into v_org;
    update public.school set org_id = v_org where id = r.id;
  end loop;

  -- leftovers from schools deleted before the removal trigger existed
  for r in select o.id from core.organisation o
            where not exists (select 1 from public.school s where s.org_id = o.id)
              and not exists (select 1 from public.university u where u.org_id = o.id) loop
    perform core.release_org(r.id);
  end loop;

  for r in select o.id from core.organisation o
            where exists (select 1 from public.school s where s.org_id = o.id)
               or exists (select 1 from public.university u where u.org_id = o.id) loop
    perform core.ensure_campustwin_subscription(r.id);
  end loop;
end $$;

insert into core.membership (org_id, user_id)
select distinct coalesce(s.org_id, u.org_id), p.id
from public.profile p
left join public.school s on s.id = p.school_id
left join public.university u on u.id = p.university_id
join auth.users au on au.id = p.id
where coalesce(s.org_id, u.org_id) is not null
on conflict (org_id, user_id) do nothing;

insert into core.product_access (membership_id, product_code)
select m.id, 'campustwin' from core.membership m
on conflict do nothing;

-- ------------------------------------------------------------ access
alter table core.organisation   enable row level security;
alter table core.product        enable row level security;
alter table core.plan           enable row level security;
alter table core.subscription   enable row level security;
alter table core.membership     enable row level security;
alter table core.product_access enable row level security;
alter table core.audit_event    enable row level security;

revoke all on schema core from public, anon, authenticated;
revoke all on all tables    in schema core from public, anon, authenticated;
revoke all on all sequences in schema core from public, anon, authenticated;
revoke all on all functions in schema core from public, anon, authenticated;
alter default privileges in schema core revoke all on tables    from public, anon, authenticated;
alter default privileges in schema core revoke all on sequences from public, anon, authenticated;
alter default privileges in schema core revoke all on functions from public, anon, authenticated;

grant usage on schema core to service_role;
grant select, insert, update, delete on all tables in schema core to service_role;
grant usage, select on all sequences in schema core to service_role;
revoke update, delete, truncate on core.audit_event from service_role;

commit;
