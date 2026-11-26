-- School admin: change history, sign-in log, plan catalogue and upgrade requests
-- for each school's own office and principal.
--
-- * public.audit_log: append-only record of changes to the school's admin data
--   (who, when, what, which fields). Only low-volume tables are logged; never
--   attendance, marks or live bus positions. Field NAMES are stored, never old
--   or new values, so salaries and personal data are not copied into the log.
--   school_id comes from the row itself, so changes made by the console,
--   cron or imports still belong to the right school; a missing actor is
--   shown as "Eternity or system".
-- * public.sign_in_log: one row per sign-in of a school login (any method),
--   written when auth.users.last_sign_in_at moves.
-- * public.campustwin_plan_catalog(): active plans (name, price, modules) for the
--   school's upgrade screen (core stays closed to signed-in users).
-- * public.plan_request: a school asks to move plan; Eternity approves in the console.
-- Everything is readable only by the school's own office or principal
-- (app.is_admin_scope() and current_school_id(), which follows a central
-- admin's active campus). Idempotent.
begin;

-- ------------------------------------------------------------ change history
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  school_id   bigint references public.school(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text not null,
  action      text not null check (action in ('added', 'changed', 'removed')),
  entity      text not null,
  entity_id   text,
  label       text,
  fields      text[] not null default '{}'
);
create index if not exists audit_log_school_at on public.audit_log (school_id, at desc);

create or replace function public.audit_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;  -- school removed: cascade
  raise exception 'The change history cannot be edited';
end $$;
drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_append_only();

-- Generic logger. TG_ARGV[0] = what the row is, in words ("Student").
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_fields text[] := '{}';
  v_actor uuid := auth.uid();
  v_name text;
  v_school bigint;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_fields
      from jsonb_object_keys(n) k
     where k not in ('updated_at', 'created_at') and (n -> k) is distinct from (o -> k);
    if cardinality(v_fields) = 0 then return null; end if;
  end if;
  v_school := case when tg_table_name = 'school' then (r ->> 'id')::bigint else (r ->> 'school_id')::bigint end;
  if v_school is null then return null; end if;
  if v_actor is not null then select p.full_name into v_name from public.profile p where p.id = v_actor; end if;
  insert into public.audit_log (school_id, actor_id, actor_name, action, entity, entity_id, label, fields)
  values (v_school, v_actor, coalesce(v_name, case when v_actor is null then 'Eternity or system' else 'Unknown user' end),
          case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
          tg_argv[0], r ->> 'id',
          left(coalesce(r ->> 'full_name', r ->> 'title', r ->> 'child_name', r ->> 'name', r ->> 'receipt_no',
                        r ->> 'accession_no', r ->> 'code', r ->> 'label', r ->> 'month'), 160),
          v_fields);
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('school', 'School settings'), ('academic_year', 'School year'), ('class', 'Class'), ('section', 'Section'),
    ('subject', 'Subject'), ('teacher_allotment', 'Teaching assignment'), ('student', 'Student'), ('guardian', 'Parent'),
    ('staff', 'Staff member'), ('staff_salary', 'Salary'), ('staff_leave', 'Staff leave'), ('staff_leave_type', 'Leave type'),
    ('payroll_run', 'Payroll'), ('leave_application', 'Student leave'), ('assessment', 'Exam'), ('promotion', 'Promotion'),
    ('fee_head', 'Fee head'), ('fee_structure', 'Fee amount'), ('fee_invoice', 'Fee invoice'), ('fee_payment', 'Fee payment'),
    ('event', 'Calendar day'), ('announcement', 'Announcement'), ('admission_enquiry', 'Admission enquiry'),
    ('library_book', 'Library book'), ('library_issue', 'Library issue'), ('library_setting', 'Library settings'),
    ('timetable_period', 'Bell period'), ('bus', 'Bus'), ('route', 'Route'), ('route_stop', 'Bus stop'),
    ('bus_assignment', 'Bus run'), ('student_transport', 'Bus rider'), ('profile', 'Login')
  ) as x(tbl, words)
  loop
    execute format('drop trigger if exists trg_log_change on public.%I', t.tbl);
    execute format('create trigger trg_log_change after insert or update or delete on public.%I
                    for each row execute function public.log_change(%L)', t.tbl, t.words);
  end loop;
end $$;

-- ------------------------------------------------------------ sign-ins
create table if not exists public.sign_in_log (
  id        bigint generated always as identity primary key,
  school_id bigint references public.school(id) on delete cascade,
  user_id   uuid not null,
  at        timestamptz not null default now()
);
create index if not exists sign_in_log_school_at on public.sign_in_log (school_id, at desc);

create or replace function public.record_sign_in() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_school bigint;
begin
  if new.last_sign_in_at is null or new.last_sign_in_at is not distinct from old.last_sign_in_at then return new; end if;
  select coalesce(p.active_campus_id, p.school_id) into v_school from public.profile p where p.id = new.id;
  if v_school is not null then
    insert into public.sign_in_log (school_id, user_id, at) values (v_school, new.id, new.last_sign_in_at);
  end if;
  return new;
end $$;
drop trigger if exists trg_record_sign_in on auth.users;
create trigger trg_record_sign_in after update of last_sign_in_at on auth.users
  for each row execute function public.record_sign_in();

-- ------------------------------------------------------------ upgrade requests
create table if not exists public.plan_request (
  id             bigint generated always as identity primary key,
  school_id      bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  requested_plan text not null,
  note           text check (note is null or char_length(note) <= 500),
  requested_by   bigint references public.staff(id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists plan_request_one_pending on public.plan_request (school_id) where status = 'pending';

-- ------------------------------------------------------------ access
alter table public.audit_log    enable row level security;
alter table public.sign_in_log  enable row level security;
alter table public.plan_request enable row level security;

drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (school_id = public.current_school_id() and app.is_admin_scope());
drop policy if exists sign_in_log_read on public.sign_in_log;
create policy sign_in_log_read on public.sign_in_log for select to authenticated
  using (school_id = public.current_school_id() and app.is_admin_scope());
drop policy if exists plan_request_read on public.plan_request;
create policy plan_request_read on public.plan_request for select to authenticated
  using (school_id = public.current_school_id() and app.is_admin_scope());
drop policy if exists plan_request_insert on public.plan_request;
create policy plan_request_insert on public.plan_request for insert to authenticated
  with check (school_id = public.current_school_id() and app.is_admin_scope() and status = 'pending');

revoke all on public.audit_log, public.sign_in_log from anon, authenticated;
grant select on public.audit_log, public.sign_in_log to authenticated;
revoke all on public.plan_request from anon, authenticated;
grant select, insert on public.plan_request to authenticated;
grant all on public.audit_log, public.sign_in_log, public.plan_request to service_role;

-- Who signed in, with their name, role and email (from the login), for this school.
create or replace function public.my_school_sign_ins(p_limit int default 200)
returns table (at timestamptz, full_name text, role text, email text)
language sql stable security definer set search_path = '' as $$
  select s.at, p.full_name, p.role::text, u.email::text
  from public.sign_in_log s
  join public.profile p on p.id = s.user_id
  left join auth.users u on u.id = s.user_id
  where app.is_admin_scope() and s.school_id = public.current_school_id()
  order by s.at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- Every login of this school with when it was made and last used.
create or replace function public.my_school_logins()
returns table (full_name text, role text, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.full_name, p.role::text, u.email::text, p.created_at, u.last_sign_in_at
  from public.profile p left join auth.users u on u.id = p.id
  where app.is_admin_scope() and coalesce(p.active_campus_id, p.school_id) = public.current_school_id()
  order by u.last_sign_in_at desc nulls last;
$$;

-- Active CampusTwin plans: safe to show any signed-in school leader.
create or replace function public.campustwin_plan_catalog()
returns table (code text, name text, price_paise bigint, modules jsonb)
language sql stable security definer set search_path = '' as $$
  select p.code, p.name, p.price_paise, coalesce(p.features -> 'modules', '{}'::jsonb)
  from core.plan p where p.product_code = 'campustwin' and p.active and app.is_admin_scope()
  order by p.price_paise, p.code;
$$;

revoke all on function public.my_school_sign_ins(int), public.my_school_logins(), public.campustwin_plan_catalog() from public, anon;
grant execute on function public.my_school_sign_ins(int), public.my_school_logins(), public.campustwin_plan_catalog() to authenticated;

commit;
