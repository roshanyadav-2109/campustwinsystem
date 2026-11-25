-- Eternity Desk, first release: tickets (requests, complaints, grievances)
-- raised through an organisation's public help page or by an agent, a
-- conversation thread with internal notes, deadlines by priority, a help
-- centre of articles, and reports.
--
-- Requesters need no account: every ticket has an unguessable tracking token,
-- and the app's server shows and accepts replies on that ticket only.
-- Agents work through row security: admins (organisation owner/admins,
-- platform owners, desk.team admins) and agents (desk.team agents).
-- Idempotent.

begin;

create schema if not exists desk;

create table if not exists desk.settings (
  org_id          uuid primary key references core.organisation(id) on delete cascade,
  display_name    text check (display_name is null or char_length(display_name) <= 200),
  public_code     text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 10)
                    check (public_code ~ '^[a-z0-9]{6,20}$'),
  form_open       boolean not null default true,
  -- hours to first response / to resolution, by priority
  respond_urgent  integer not null default 2   check (respond_urgent between 1 and 720),
  respond_high    integer not null default 8   check (respond_high between 1 and 720),
  respond_normal  integer not null default 24  check (respond_normal between 1 and 720),
  respond_low     integer not null default 72  check (respond_low between 1 and 720),
  resolve_urgent  integer not null default 24  check (resolve_urgent between 1 and 2160),
  resolve_high    integer not null default 72  check (resolve_high between 1 and 2160),
  resolve_normal  integer not null default 168 check (resolve_normal between 1 and 2160),
  resolve_low     integer not null default 336 check (resolve_low between 1 and 2160),
  updated_at      timestamptz not null default now()
);

create table if not exists desk.team (
  org_id   uuid not null references core.organisation(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null check (role in ('admin', 'agent')),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists desk.category (
  id      bigint generated always as identity primary key,
  org_id  uuid not null references core.organisation(id) on delete cascade,
  name    text not null check (char_length(btrim(name)) between 1 and 80),
  active  boolean not null default true,
  unique (org_id, name),
  unique (org_id, id)
);

create table if not exists desk.ticket (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references core.organisation(id) on delete cascade,
  number            integer not null,
  subject           text not null check (char_length(btrim(subject)) between 1 and 200),
  description       text not null check (char_length(btrim(description)) between 1 and 8000),
  kind              text not null default 'request' check (kind in ('request', 'complaint', 'grievance')),
  category_id       bigint,
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status            text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  requester_name    text not null check (char_length(btrim(requester_name)) between 1 and 150),
  requester_email   text check (requester_email is null or requester_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  requester_phone   text check (requester_phone is null or char_length(requester_phone) <= 20),
  assignee_id       uuid references auth.users(id) on delete set null,
  source            text not null default 'web' check (source in ('web', 'agent')),
  public_token      uuid not null unique default gen_random_uuid(),
  respond_by        timestamptz,
  resolve_by        timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, id),
  foreign key (org_id, category_id) references desk.category (org_id, id) on delete set null (category_id)
);
create index if not exists ticket_queue on desk.ticket (org_id, status, priority, created_at);
create index if not exists ticket_assignee on desk.ticket (assignee_id) where assignee_id is not null;

create table if not exists desk.message (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  ticket_id      bigint not null,
  author_kind    text not null check (author_kind in ('requester', 'agent')),
  author_user_id uuid,
  author_name    text not null check (char_length(author_name) between 1 and 150),
  body           text not null check (char_length(btrim(body)) between 1 and 8000),
  internal       boolean not null default false,
  created_at     timestamptz not null default now(),
  foreign key (org_id, ticket_id) references desk.ticket (org_id, id) on delete cascade,
  check (not internal or author_kind = 'agent')
);
create index if not exists message_ticket on desk.message (ticket_id, created_at);

create table if not exists desk.article (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organisation(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  body        text not null check (char_length(btrim(body)) between 1 and 20000),
  category_id bigint,
  published   boolean not null default true,
  updated_at  timestamptz not null default now(),
  foreign key (org_id, category_id) references desk.category (org_id, id) on delete set null (category_id)
);

create table if not exists desk.series (
  org_id  uuid primary key references core.organisation(id) on delete cascade,
  current integer not null
);

-- ------------------------------------------------------------ access
create or replace function desk.subscribed(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.subscription s
    where s.org_id = p_org and s.product_code = 'desk' and s.status in ('trial', 'active', 'past_due'))
$$;

-- 'admin', 'agent' or null.
create or replace function desk.role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not desk.subscribed(p_org) then null
    when exists (select 1 from public.platform_owner po join auth.users u on lower(u.email) = lower(po.email) where u.id = auth.uid()) then 'admin'
    when exists (select 1 from core.membership m where m.org_id = p_org and m.user_id = auth.uid()
                  and m.status = 'active' and m.role in ('owner', 'admin')) then 'admin'
    else (select t.role from desk.team t where t.org_id = p_org and t.user_id = auth.uid())
  end
$$;

create or replace function desk.my_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from core.organisation o where o.status = 'active' and desk.role(o.id) is not null
$$;

-- People who can be assigned tickets in an organisation (for the agent picker).
create or replace function desk.agents(p_org uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, t.role from desk.team t join auth.users u on u.id = t.user_id
  where t.org_id = p_org and desk.role(p_org) is not null
  union
  select u.id, u.email::text, 'admin' from core.membership m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and m.status = 'active' and m.role in ('owner', 'admin') and desk.role(p_org) is not null
$$;

-- ------------------------------------------------------------ ticket rules
create or replace function desk.ticket_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s desk.settings; v_respond int; v_resolve int;
begin
  if tg_op = 'INSERT' then
    select * into s from desk.settings where org_id = new.org_id;
    if not found then raise exception 'The help desk is not set up'; end if;
    insert into desk.series as sr (org_id, current) values (new.org_id, 1)
    on conflict (org_id) do update set current = sr.current + 1
    returning current into new.number;
    new.status := 'open';
    new.first_response_at := null; new.resolved_at := null; new.closed_at := null;
    if new.requester_email is not null then new.requester_email := lower(btrim(new.requester_email)); end if;
    -- grievances are never low priority
    if new.kind = 'grievance' and new.priority = 'low' then new.priority := 'normal'; end if;
  else
    if new.org_id <> old.org_id or new.number <> old.number or new.public_token <> old.public_token or new.created_at <> old.created_at then
      raise exception 'These ticket details cannot be changed';
    end if;
    new.updated_at := now();
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.resolved_at := coalesce(new.resolved_at, now()); end if;
    if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
    if new.status not in ('resolved', 'closed') then new.resolved_at := null; new.closed_at := null; end if;
    select * into s from desk.settings where org_id = new.org_id;
  end if;
  -- deadlines follow the priority (recomputed if the priority changes)
  if tg_op = 'INSERT' or new.priority <> old.priority then
    v_respond := case new.priority when 'urgent' then s.respond_urgent when 'high' then s.respond_high when 'normal' then s.respond_normal else s.respond_low end;
    v_resolve := case new.priority when 'urgent' then s.resolve_urgent when 'high' then s.resolve_high when 'normal' then s.resolve_normal else s.resolve_low end;
    new.respond_by := new.created_at + make_interval(hours => v_respond);
    new.resolve_by := new.created_at + make_interval(hours => v_resolve);
  end if;
  return new;
end $$;
drop trigger if exists ticket_rules on desk.ticket;
create trigger ticket_rules before insert or update on desk.ticket
  for each row execute function desk.ticket_rules();

-- Messages are never edited. The first public agent reply records the first
-- response; a requester replying to a resolved ticket reopens it.
create or replace function desk.message_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Messages cannot be changed';
  end if;
  if new.author_kind = 'agent' and not new.internal then
    update desk.ticket set first_response_at = coalesce(first_response_at, now()),
           status = case when status = 'open' then 'in_progress' else status end
     where id = new.ticket_id;
  elsif new.author_kind = 'requester' then
    update desk.ticket set status = case when status in ('resolved', 'waiting') then 'open' else status end
     where id = new.ticket_id and status <> 'closed';
    if exists (select 1 from desk.ticket where id = new.ticket_id and status = 'closed') then
      raise exception 'This request is closed; please raise a new one';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists message_rules on desk.message;
create trigger message_rules before insert or update or delete on desk.message
  for each row execute function desk.message_rules();

-- ------------------------------------------------------------ setup
create or replace function desk.setup(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if desk.role(p_org) is distinct from 'admin' then raise exception 'Only a desk admin can set this up'; end if;
  insert into desk.settings (org_id, display_name) values (p_org, (select o.name from core.organisation o where o.id = p_org))
  on conflict (org_id) do nothing;
  insert into desk.category (org_id, name)
  select p_org, n from unnest(array['Fees and payments', 'Academics', 'Admissions', 'Transport', 'Login and technical', 'Facilities', 'Other']) n
  on conflict (org_id, name) do nothing;
end $$;

-- ------------------------------------------------------------ row security
alter table desk.settings enable row level security;
alter table desk.team     enable row level security;
alter table desk.category enable row level security;
alter table desk.ticket   enable row level security;
alter table desk.message  enable row level security;
alter table desk.article  enable row level security;
alter table desk.series   enable row level security;

drop policy if exists settings_read on desk.settings;
create policy settings_read on desk.settings for select to authenticated using (desk.role(org_id) is not null);
drop policy if exists settings_write on desk.settings;
create policy settings_write on desk.settings for update to authenticated using (desk.role(org_id) = 'admin') with check (desk.role(org_id) = 'admin');
drop policy if exists team_read on desk.team;
create policy team_read on desk.team for select to authenticated using (desk.role(org_id) is not null);
drop policy if exists team_write on desk.team;
create policy team_write on desk.team for all to authenticated using (desk.role(org_id) = 'admin') with check (desk.role(org_id) = 'admin');

do $$
declare t text;
begin
  foreach t in array array['category', 'ticket', 'article'] loop
    execute format('drop policy if exists %1$s_read on desk.%1$s', t);
    execute format('create policy %1$s_read on desk.%1$s for select to authenticated using (desk.role(org_id) is not null)', t);
    execute format('drop policy if exists %1$s_write on desk.%1$s', t);
    execute format('create policy %1$s_write on desk.%1$s for all to authenticated using (desk.role(org_id) is not null) with check (desk.role(org_id) is not null)', t);
  end loop;
end $$;
-- categories and articles: only admins change them
drop policy if exists category_write on desk.category;
create policy category_write on desk.category for all to authenticated using (desk.role(org_id) = 'admin') with check (desk.role(org_id) = 'admin');
drop policy if exists ticket_write on desk.ticket;
create policy ticket_write on desk.ticket for insert to authenticated with check (desk.role(org_id) is not null);
drop policy if exists ticket_update on desk.ticket;
create policy ticket_update on desk.ticket for update to authenticated using (desk.role(org_id) is not null) with check (desk.role(org_id) is not null);

drop policy if exists message_read on desk.message;
create policy message_read on desk.message for select to authenticated using (desk.role(org_id) is not null);
drop policy if exists message_write on desk.message;
create policy message_write on desk.message for insert to authenticated
  with check (desk.role(org_id) is not null and author_kind = 'agent' and author_user_id = auth.uid());

-- ------------------------------------------------------------ grants
revoke all on schema desk from public, anon;
revoke all on all tables    in schema desk from public, anon;
revoke all on all sequences in schema desk from public, anon;
revoke all on all functions in schema desk from public, anon;
alter default privileges in schema desk revoke all on tables    from public, anon;
alter default privileges in schema desk revoke all on sequences from public, anon;
alter default privileges in schema desk revoke all on functions from public, anon;

grant usage on schema desk to authenticated, service_role;
grant select, insert, update, delete on all tables in schema desk to authenticated, service_role;
grant usage, select on all sequences in schema desk to authenticated, service_role;
revoke delete on desk.ticket from authenticated;
revoke update, delete on desk.message from authenticated;
revoke insert, update, delete on desk.series from authenticated;
revoke insert, delete on desk.settings from authenticated;
grant execute on function desk.subscribed(uuid), desk.role(uuid), desk.my_orgs(), desk.agents(uuid), desk.setup(uuid)
  to authenticated, service_role;

-- the shared Google sign-in admits desk agents
create or replace function core.login_for_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and (exists (select 1 from core.membership m where m.user_id = u.id and m.status = 'active')
      or exists (select 1 from fin.team t where t.user_id = u.id)
      or exists (select 1 from hr.team t where t.user_id = u.id)
      or exists (select 1 from alum.team t where t.user_id = u.id)
      or exists (select 1 from alum.member a where a.user_id = u.id and a.status = 'verified')
      or exists (select 1 from desk.team t where t.user_id = u.id))
  limit 1
$$;
revoke all on function core.login_for_email(text) from public, anon, authenticated;
grant execute on function core.login_for_email(text) to service_role;

commit;
