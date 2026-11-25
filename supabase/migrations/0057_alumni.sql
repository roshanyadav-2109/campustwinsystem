-- Eternity Alumni, first release: alumni records with verification, directory,
-- events with RSVP, jobs board, news, and giving (campaigns, donations, 80G
-- receipts with Indian rules).
--
-- Access per organisation with a live `alumni` subscription:
--   * admin  : organisation owner/admins, platform owners, alum.team admins
--   * editor : alum.team editors (manage records, events, news, donations)
--   * member : a verified alumnus linked to their login
-- 80G receipts are issued by the database only when the law allows: the
-- campaign is 80G-eligible, the institution's 80G registration is on file, the
-- donor is Indian or NRI with a PAN, and it is not cash above Rs 2,000.
-- Foreign donations are refused unless the institution is FCRA-registered.
-- Idempotent.

begin;

create schema if not exists alum;

-- ------------------------------------------------------------ settings and access
create table if not exists alum.settings (
  org_id              uuid primary key references core.organisation(id) on delete cascade,
  display_name        text check (display_name is null or char_length(display_name) <= 200),
  address             text check (address is null or char_length(address) <= 500),
  pan                 text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  reg_80g             text check (reg_80g is null or char_length(reg_80g) between 5 and 60),
  reg_80g_valid_until date,
  fcra_registered     boolean not null default false,
  join_open           boolean not null default true,
  join_code           text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 10)
                        check (join_code ~ '^[a-z0-9]{6,20}$'),
  updated_at          timestamptz not null default now()
);

create table if not exists alum.team (
  org_id   uuid not null references core.organisation(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null check (role in ('admin', 'editor')),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists alum.member (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references core.organisation(id) on delete cascade,
  full_name         text not null check (char_length(btrim(full_name)) between 1 and 150),
  email             text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone             text check (phone is null or char_length(phone) <= 20),
  batch_year        smallint check (batch_year is null or batch_year between 1900 and 2100),
  programme         text check (programme is null or char_length(programme) <= 120),
  roll_number       text check (roll_number is null or char_length(roll_number) <= 40),
  company           text check (company is null or char_length(company) <= 120),
  job_title         text check (job_title is null or char_length(job_title) <= 120),
  higher_studies    text check (higher_studies is null or char_length(higher_studies) <= 160),
  city              text check (city is null or char_length(city) <= 80),
  country           text not null default 'India' check (char_length(country) <= 60),
  linkedin_url      text check (linkedin_url is null or linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/'),
  status            text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  show_in_directory boolean not null default true,
  source            text not null default 'admin' check (source in ('admin', 'import', 'self')),
  user_id           uuid references auth.users(id) on delete set null,
  verified_at       timestamptz,
  verified_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, id)
);
create unique index if not exists member_org_email on alum.member (org_id, lower(email)) where email is not null;
create unique index if not exists member_org_user on alum.member (org_id, user_id) where user_id is not null;
create index if not exists member_directory on alum.member (org_id, status, batch_year);

create table if not exists alum.event (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organisation(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 160),
  starts_at   timestamptz not null,
  venue       text check (venue is null or char_length(venue) <= 200),
  online_url  text check (online_url is null or online_url ~ '^https://'),
  description text check (description is null or char_length(description) <= 4000),
  capacity    integer check (capacity is null or capacity > 0),
  status      text not null default 'published' check (status in ('published', 'cancelled')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (org_id, id)
);

create table if not exists alum.rsvp (
  org_id     uuid not null,
  event_id   bigint not null,
  member_id  bigint not null,
  status     text not null check (status in ('going', 'not_going')),
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id),
  foreign key (org_id, event_id)  references alum.event (org_id, id) on delete cascade,
  foreign key (org_id, member_id) references alum.member (org_id, id) on delete cascade
);

create table if not exists alum.job (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organisation(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 160),
  company     text not null check (char_length(btrim(company)) between 1 and 120),
  location    text check (location is null or char_length(location) <= 120),
  apply_url   text check (apply_url is null or apply_url ~ '^(https://|mailto:)'),
  description text check (description is null or char_length(description) <= 4000),
  closes_on   date,
  status      text not null default 'open' check (status in ('open', 'closed')),
  member_id   bigint,                       -- the alumnus who posted it, if any
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (org_id, member_id) references alum.member (org_id, id) on delete set null (member_id)
);

create table if not exists alum.post (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organisation(id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 160),
  body       text not null check (char_length(btrim(body)) between 1 and 8000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists alum.campaign (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references core.organisation(id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 160),
  description  text check (description is null or char_length(description) <= 4000),
  goal         numeric(15,2) check (goal is null or goal > 0),
  fund_type    text not null default 'specific' check (fund_type in ('corpus', 'specific', 'general')),
  eligible_80g boolean not null default true,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, id)
);

create table if not exists alum.donation (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references core.organisation(id) on delete cascade,
  campaign_id       bigint not null,
  member_id         bigint,
  donor_name        text not null check (char_length(btrim(donor_name)) between 1 and 150),
  donor_email       text check (donor_email is null or donor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  donor_pan         text check (donor_pan is null or donor_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  donor_address     text check (donor_address is null or char_length(donor_address) <= 500),
  donor_citizenship text not null default 'indian' check (donor_citizenship in ('indian', 'nri', 'foreign')),
  amount            numeric(15,2) not null check (amount > 0),
  mode              text not null check (mode in ('cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other')),
  reference         text check (reference is null or char_length(reference) <= 80),
  donated_on        date not null,
  eligible_80g      boolean not null default false,
  not_eligible_why  text,
  receipt_number    text,
  status            text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  cancelled_at      timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (org_id, campaign_id) references alum.campaign (org_id, id),
  foreign key (org_id, member_id)   references alum.member (org_id, id) on delete set null (member_id),
  check (not eligible_80g or receipt_number is not null)
);
create unique index if not exists donation_receipt on alum.donation (org_id, receipt_number) where receipt_number is not null;
create index if not exists donation_org_date on alum.donation (org_id, donated_on);

create table if not exists alum.series (
  org_id  uuid not null references core.organisation(id) on delete cascade,
  prefix  text not null,
  fy      text not null,
  current integer not null,
  primary key (org_id, prefix, fy)
);

-- ------------------------------------------------------------ access helpers
create or replace function alum.subscribed(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.subscription s
    where s.org_id = p_org and s.product_code = 'alumni' and s.status in ('trial', 'active', 'past_due'))
$$;

create or replace function alum.my_member(p_org uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select m.id from alum.member m where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'verified' limit 1
$$;

-- 'admin', 'editor', 'member' or null.
create or replace function alum.role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not alum.subscribed(p_org) then null
    when exists (select 1 from public.platform_owner po join auth.users u on lower(u.email) = lower(po.email) where u.id = auth.uid()) then 'admin'
    when exists (select 1 from core.membership m where m.org_id = p_org and m.user_id = auth.uid()
                  and m.status = 'active' and m.role in ('owner', 'admin')) then 'admin'
    when exists (select 1 from alum.team t where t.org_id = p_org and t.user_id = auth.uid()) then
      (select t.role from alum.team t where t.org_id = p_org and t.user_id = auth.uid())
    when alum.my_member(p_org) is not null then 'member'
    else null
  end
$$;

create or replace function alum.is_staff(p_org uuid) returns boolean
language sql stable as $$ select coalesce(alum.role(p_org) in ('admin', 'editor'), false) $$;

create or replace function alum.my_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from core.organisation o where o.status = 'active' and alum.role(o.id) is not null
$$;

-- ------------------------------------------------------------ member rules
-- Emails are kept lower-case; a record with the email of an existing login is
-- linked to it. Alumni may edit their own profile, but not their status,
-- email, batch or who verified them.
create or replace function alum.member_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  if new.user_id is null and new.email is not null and new.status = 'verified' then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'verified' and old.status <> 'verified' then
      new.verified_at := now(); new.verified_by := auth.uid();
    end if;
    -- the signed-in person's role from their login token (inside this function current_user is the owner)
    if coalesce(auth.role(), '') = 'authenticated' and not alum.is_staff(new.org_id) then
      if (new.status, new.email, new.batch_year, new.roll_number, new.user_id, new.org_id, new.verified_at, new.source)
         is distinct from (old.status, old.email, old.batch_year, old.roll_number, old.user_id, old.org_id, old.verified_at, old.source) then
        raise exception 'Only the alumni office can change status, email, batch or roll number';
      end if;
    end if;
  elsif tg_op = 'INSERT' and new.status = 'verified' then
    new.verified_at := now(); new.verified_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists member_rules on alum.member;
create trigger member_rules before insert or update on alum.member
  for each row execute function alum.member_rules();

-- ------------------------------------------------------------ donation rules
create or replace function alum.fy(d date) returns text language sql immutable as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end
$$;

create or replace function alum.donation_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s alum.settings;
  c alum.campaign;
  v_why text;
  v_n integer;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then raise exception 'A cancelled donation cannot be changed'; end if;
    if (new.amount, new.donor_name, new.donor_pan, new.donor_citizenship, new.mode, new.donated_on, new.campaign_id, new.org_id, new.receipt_number, new.eligible_80g)
       is distinct from (old.amount, old.donor_name, old.donor_pan, old.donor_citizenship, old.mode, old.donated_on, old.campaign_id, old.org_id, old.receipt_number, old.eligible_80g) then
      raise exception 'A recorded donation cannot be changed; cancel it and record it again';
    end if;
    if new.status = 'cancelled' then new.cancelled_at := now(); end if;
    return new;
  end if;

  new.status := 'recorded';
  new.donor_pan := nullif(upper(btrim(coalesce(new.donor_pan, ''))), '');
  if new.donor_email is not null then new.donor_email := lower(btrim(new.donor_email)); end if;
  select * into s from alum.settings where org_id = new.org_id;
  select * into c from alum.campaign where id = new.campaign_id and org_id = new.org_id;
  if not found then raise exception 'Choose a campaign'; end if;

  if new.donor_citizenship = 'foreign' and not coalesce(s.fcra_registered, false) then
    raise exception 'Donations from foreign citizens need FCRA registration; this institution is not FCRA-registered';
  end if;

  v_why := case
    when not c.eligible_80g then 'This campaign is not eligible for 80G'
    when s.reg_80g is null then 'The institution''s 80G registration is not set'
    when s.reg_80g_valid_until is not null and s.reg_80g_valid_until < new.donated_on then 'The 80G registration had expired on this date'
    when new.donor_citizenship = 'foreign' then 'Foreign contributions do not qualify for 80G'
    when new.donor_pan is null then 'The donor''s PAN is needed for an 80G receipt'
    when new.mode = 'cash' and new.amount > 2000 then 'Cash donations above Rs 2,000 do not qualify for 80G'
    else null end;
  new.eligible_80g := v_why is null;
  new.not_eligible_why := v_why;
  new.receipt_number := null;
  if new.eligible_80g then
    insert into alum.series as sr (org_id, prefix, fy, current) values (new.org_id, '80G', alum.fy(new.donated_on), 1)
    on conflict (org_id, prefix, fy) do update set current = sr.current + 1
    returning current into v_n;
    new.receipt_number := '80G/' || alum.fy(new.donated_on) || '/' || lpad(v_n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists donation_rules on alum.donation;
create trigger donation_rules before insert or update on alum.donation
  for each row execute function alum.donation_rules();

create or replace function alum.no_delete() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Donations are never deleted; cancel instead';
end $$;
drop trigger if exists donation_no_delete on alum.donation;
create trigger donation_no_delete before delete on alum.donation
  for each row execute function alum.no_delete();

-- ------------------------------------------------------------ row security
alter table alum.settings enable row level security;
alter table alum.team     enable row level security;
alter table alum.member   enable row level security;
alter table alum.event    enable row level security;
alter table alum.rsvp     enable row level security;
alter table alum.job      enable row level security;
alter table alum.post     enable row level security;
alter table alum.campaign enable row level security;
alter table alum.donation enable row level security;
alter table alum.series   enable row level security;

drop policy if exists settings_read on alum.settings;
create policy settings_read on alum.settings for select to authenticated using (alum.role(org_id) is not null);
drop policy if exists settings_write on alum.settings;
create policy settings_write on alum.settings for update to authenticated using (alum.role(org_id) = 'admin') with check (alum.role(org_id) = 'admin');

drop policy if exists team_read on alum.team;
create policy team_read on alum.team for select to authenticated using (alum.role(org_id) = 'admin');
drop policy if exists team_write on alum.team;
create policy team_write on alum.team for all to authenticated using (alum.role(org_id) = 'admin') with check (alum.role(org_id) = 'admin');

-- staff see every record; alumni see verified, listed alumni and themselves
drop policy if exists member_read on alum.member;
create policy member_read on alum.member for select to authenticated using (
  alum.is_staff(org_id)
  or (alum.role(org_id) = 'member' and status = 'verified' and show_in_directory)
  or (user_id = auth.uid()));
drop policy if exists member_staff on alum.member;
create policy member_staff on alum.member for all to authenticated using (alum.is_staff(org_id)) with check (alum.is_staff(org_id));
drop policy if exists member_self on alum.member;
create policy member_self on alum.member for update to authenticated
  using (user_id = auth.uid() and status = 'verified') with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['event', 'post', 'campaign'] loop
    execute format('drop policy if exists %1$s_read on alum.%1$s', t);
    execute format('create policy %1$s_read on alum.%1$s for select to authenticated using (alum.role(org_id) is not null)', t);
    execute format('drop policy if exists %1$s_write on alum.%1$s', t);
    execute format('create policy %1$s_write on alum.%1$s for all to authenticated using (alum.is_staff(org_id)) with check (alum.is_staff(org_id))', t);
  end loop;
end $$;

drop policy if exists rsvp_read on alum.rsvp;
create policy rsvp_read on alum.rsvp for select to authenticated using (alum.is_staff(org_id) or member_id = alum.my_member(org_id));
drop policy if exists rsvp_self on alum.rsvp;
create policy rsvp_self on alum.rsvp for all to authenticated
  using (member_id = alum.my_member(org_id)) with check (member_id = alum.my_member(org_id));

drop policy if exists job_read on alum.job;
create policy job_read on alum.job for select to authenticated using (alum.role(org_id) is not null);
drop policy if exists job_staff on alum.job;
create policy job_staff on alum.job for all to authenticated using (alum.is_staff(org_id)) with check (alum.is_staff(org_id));
drop policy if exists job_own on alum.job;
create policy job_own on alum.job for all to authenticated
  using (member_id is not null and member_id = alum.my_member(org_id))
  with check (member_id is not null and member_id = alum.my_member(org_id));

drop policy if exists donation_read on alum.donation;
create policy donation_read on alum.donation for select to authenticated using (
  alum.is_staff(org_id) or (member_id is not null and member_id = alum.my_member(org_id)));
drop policy if exists donation_staff on alum.donation;
create policy donation_staff on alum.donation for all to authenticated using (alum.is_staff(org_id)) with check (alum.is_staff(org_id));

-- ------------------------------------------------------------ setup
-- First use by an admin: create the organisation's alumni settings (its public
-- join link code is generated here). Safe to run again.
create or replace function alum.setup(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if alum.role(p_org) is distinct from 'admin' then raise exception 'Only an alumni admin can set this up'; end if;
  insert into alum.settings (org_id, display_name)
  values (p_org, (select o.name from core.organisation o where o.id = p_org))
  on conflict (org_id) do nothing;
end $$;

-- ------------------------------------------------------------ the shared sign-in
-- Verified alumni and the alumni team can sign in with Google too.
create or replace function core.login_for_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and (exists (select 1 from core.membership m where m.user_id = u.id and m.status = 'active')
      or exists (select 1 from fin.team t where t.user_id = u.id)
      or exists (select 1 from hr.team t where t.user_id = u.id)
      or exists (select 1 from alum.team t where t.user_id = u.id)
      or exists (select 1 from alum.member a where a.user_id = u.id and a.status = 'verified'))
  limit 1
$$;
revoke all on function core.login_for_email(text) from public, anon, authenticated;
grant execute on function core.login_for_email(text) to service_role;

-- ------------------------------------------------------------ grants
revoke all on schema alum from public, anon;
revoke all on all tables    in schema alum from public, anon;
revoke all on all sequences in schema alum from public, anon;
revoke all on all functions in schema alum from public, anon;
alter default privileges in schema alum revoke all on tables    from public, anon;
alter default privileges in schema alum revoke all on sequences from public, anon;
alter default privileges in schema alum revoke all on functions from public, anon;

grant usage on schema alum to authenticated, service_role;
grant select, insert, update, delete on all tables in schema alum to authenticated, service_role;
grant usage, select on all sequences in schema alum to authenticated, service_role;
revoke insert, update, delete on alum.series from authenticated;
revoke insert, delete on alum.settings from authenticated;
grant execute on function alum.subscribed(uuid), alum.my_member(uuid), alum.role(uuid), alum.is_staff(uuid), alum.my_orgs(), alum.fy(date), alum.setup(uuid)
  to authenticated, service_role;

-- Reference links are checked when the change is saved, so removing an
-- organisation cascades cleanly while deleting a row still in use is refused.
do $fix$
declare c record;
begin
  for c in select conrelid::regclass as t, conname from pg_constraint
           where connamespace = 'alum'::regnamespace and contype = 'f' and confdeltype = 'a' and not condeferrable loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', c.t, c.conname);
  end loop;
end $fix$;

commit;
