-- Roles extras after review: the finance head gets fees and payments only; staff leave steps cannot be forged, stuck steps can be moved on,
-- the home department's Head decides, refusals need a reason; a service department sees only its own courses' marks.
begin;
-- ---------- the finance head: fees and payments only (not leave, salaries or positions) ----------
create or replace function app.my_staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select case
    when x.role = 'principal' then x.role
    when x.types && array['head', 'deputy_head'] then 'principal'::public.staff_role
    when x.role = 'office' then x.role
    when 'registrar' = any(x.types) then 'office'::public.staff_role
    else x.role end
  from (select s.role, app.my_access_types() types from public.staff s where s.id = app.my_staff_id()) x;
$$;
create or replace function app.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_staff_role() = 'office', false) or coalesce(app.my_base_role() = 'office', false) or app.has_access('registrar');
$$;
create or replace function app.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office() or app.has_access('finance_head');
$$;
grant execute on function app.is_finance() to authenticated, service_role;

-- fee and payment rows: the office's rules now also admit the finance head
do $$ declare r record; q text; c text;
begin
  for r in select tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' and (tablename like 'fee%' or tablename like 'payment%')
             and (coalesce(qual, '') ~ 'is_office|is_admin_scope' or coalesce(with_check, '') ~ 'is_office|is_admin_scope') loop
    q := replace(replace(r.qual, 'app.is_office()', 'app.is_finance()'), 'app.is_admin_scope()', '(app.is_admin_scope() OR app.is_finance())');
    c := replace(replace(r.with_check, 'app.is_office()', 'app.is_finance()'), 'app.is_admin_scope()', '(app.is_admin_scope() OR app.is_finance())');
    if q is not null and c is not null then execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, q, c);
    elsif q is not null then execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, q);
    elsif c is not null then execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, c); end if;
  end loop;
end $$;
-- and the fee functions the office runs
do $$ declare f record; d text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc like '%app.is_office()%'
             and (p.prosrc like '%fee_invoice%' or p.prosrc like '%fee_payment%' or p.prosrc like '%fee_structure%' or p.prosrc like '%payment_gateway%' or p.prosrc like '%fee_concession%')
             and p.prosrc not like '%staff_position%' and p.prosrc not like '%admission_enquiry%' loop
    d := pg_get_functiondef(f.oid);
    execute replace(d, 'app.is_office()', 'app.is_finance()');
  end loop;
end $$;

-- the department a teacher belongs to: their own position's department; only if none, the departments they teach in
create or replace function app.staff_home_departments(p_staff bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  with pos as (select p.department_id from public.staff_position p where p.staff_id = p_staff and p.department_id is not null
                 and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date))
  select department_id from pos
  union
  select c.department_id from public.teacher_allotment ta join public.subject sb on sb.id = ta.subject_id join public.course c on c.id = sb.course_id
  where ta.staff_id = p_staff and ta.academic_year_id = app.current_year_id() and c.department_id is not null and not exists (select 1 from pos);
$$;

create or replace function public.staff_leave_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_steps text[] := '{}';
begin
  -- the chain is always worked out here, never taken from the request
  new.step_log := '[]'::jsonb; new.steps := null; new.step := null;
  if not public.is_higher_ed(new.school_id) then return new; end if;
  if exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             where t.access_type = 'dept_head' and p.staff_id <> new.staff_id and p.department_id in (select app.staff_home_departments(new.staff_id))
               and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) then v_steps := v_steps || 'hod'::text; end if;
  if exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             join public.department d on d.unit_id is not null and d.id in (select app.staff_home_departments(new.staff_id))
             where t.access_type = 'dean' and p.staff_id <> new.staff_id and p.unit_id is not null
               and d.unit_id in (select public.unit_descendants(p.unit_id))
               and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) then v_steps := v_steps || 'dean'::text; end if;
  new.steps := v_steps || 'final'::text;
  new.step := new.steps[1];
  return new;
end $$;

-- the chain columns change only through advance_staff_leave
create or replace function public.staff_leave_order_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.leave_step', true) is distinct from 'on' and (new.steps is distinct from old.steps or new.step is distinct from old.step or new.step_log is distinct from old.step_log) then
    raise exception 'The approval steps cannot be changed directly';
  end if;
  if new.status = 'approved' and old.status = 'pending' and old.step is not null and old.step <> 'final' then
    raise exception 'This leave is waiting for the % first', case old.step when 'hod' then 'Head of Department' else 'Dean' end;
  end if;
  return new;
end $$;

-- the Head or Dean recommends or refuses (a reason is needed to refuse); the head of the institution or the office may move a stuck step on
create or replace function public.advance_staff_leave(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.staff_leave; v_ok boolean; v_override boolean := false; v_next text;
begin
  select * into l from public.staff_leave where id = p_id and school_id = public.current_school_id() for update;
  if l.id is null or l.status <> 'pending' or l.step is null or l.step = 'final' then raise exception 'Nothing waiting for you here'; end if;
  if l.staff_id = app.my_staff_id() then raise exception 'You cannot decide your own leave'; end if;
  v_ok := case l.step
    when 'hod' then exists (select 1 from app.staff_home_departments(l.staff_id) d where d in (select app.my_headed_departments()))
    when 'dean' then exists (select 1 from app.staff_home_departments(l.staff_id) d where d in (select app.my_dean_departments())) end;
  if not coalesce(v_ok, false) then
    if coalesce(app.is_head(), false) or coalesce(app.is_office(), false) then v_override := true;
    else raise exception 'This step is for the % of the teacher''s department', case l.step when 'hod' then 'Head' else 'Dean' end; end if;
  end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Give the reason for refusing'; end if;
  perform set_config('app.leave_step', 'on', true);
  if not p_approve then
    update public.staff_leave set status = 'rejected', decided_by = app.my_staff_id(), decided_at = now(), decision_note = left(trim(p_note), 500),
      step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'name', (select full_name from public.staff where id = app.my_staff_id()), 'at', now(), 'ok', false, 'note', left(p_note, 200), 'override', v_override) where id = l.id;
    perform set_config('app.leave_step', 'off', true);
    return 'rejected';
  end if;
  v_next := l.steps[array_position(l.steps, l.step) + 1];
  update public.staff_leave set step = coalesce(v_next, 'final'),
    step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'name', (select full_name from public.staff where id = app.my_staff_id()), 'at', now(), 'ok', true, 'note', left(coalesce(p_note, ''), 200), 'override', v_override) where id = l.id;
  perform set_config('app.leave_step', 'off', true);
  return coalesce(v_next, 'final');
end $$;
revoke all on function public.advance_staff_leave(bigint, boolean, text) from public, anon;
grant execute on function public.advance_staff_leave(bigint, boolean, text) to authenticated;

create or replace function public.my_leave_steps()
returns table (id bigint, staff_name text, from_date date, to_date date, days numeric, reason text, step text, leave_type text)
language sql stable security definer set search_path = '' as $$
  with hd as (select app.my_headed_departments() d), dd as (select app.my_dean_departments() d)
  select l.id, s.full_name, l.from_date, l.to_date, l.days, l.reason, l.step, lt.name
  from public.staff_leave l join public.staff s on s.id = l.staff_id left join public.staff_leave_type lt on lt.id = l.leave_type_id
  where l.school_id = public.current_school_id() and l.status = 'pending' and l.staff_id <> app.my_staff_id() and l.step in ('hod', 'dean')
    and exists (select 1 from app.staff_home_departments(l.staff_id) x where (l.step = 'hod' and x in (select d from hd)) or (l.step = 'dean' and x in (select d from dd)))
  order by l.from_date;
$$;

create or replace function app.my_dept_students() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select e.student_id from public.student_enrollment e
  where exists (select 1 from app.my_positions_now()) and e.status = 'active'
    and e.section_id in (select app.my_scope_sections()) and e.academic_year_id = app.current_year_id();
$$;
-- (student, subject) pairs a service department may see: its own courses taught to other programmes
create or replace function app.my_service_marks() returns table (student_id bigint, subject_id bigint)
language sql stable security definer set search_path = '' as $$
  select rg.student_id, sb.id from public.course_registration rg join public.programme_course pc on pc.id = rg.programme_course_id
  join public.course c on c.id = pc.course_id join public.subject sb on sb.course_id = c.id join public.semester sm on sm.id = rg.semester_id and sm.is_current
  where exists (select 1 from app.my_positions_now()) and coalesce(rg.status, '') <> 'dropped'
    and (c.department_id in (select app.my_headed_departments()) or c.department_id in (select app.my_dean_departments()));
$$;
grant execute on function app.my_service_marks() to authenticated;
drop policy if exists service_marks_read on public.mark;
create policy service_marks_read on public.mark for select to authenticated using (
  exists (select 1 from public.assessment a join app.my_service_marks() sm on sm.subject_id = a.subject_id and sm.student_id = mark.student_id where a.id = mark.assessment_id));

-- the chart counts only positions already started


create or replace function public.university_org_chart() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.current_university_id() is not null then jsonb_build_object(
    'university', (select name from public.university where id = public.current_university_id()),
    'central', coalesce((select jsonb_agg(jsonb_build_object('title', t.name, 'holder', s.full_name, 'acting', p.acting) order by t.sort, t.name)
                from public.staff_position p join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id
                where t.scope_level = 'university' and p.school_id in (select public.university_school_ids())
                  and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)), '[]'),
    'campuses', coalesce((select jsonb_agg(jsonb_build_object('campus', c.name, 'positions',
                  coalesce((select jsonb_agg(jsonb_build_object('title', t.name, 'holder', s.full_name, 'acting', p.acting) order by t.sort, t.name)
                    from public.staff_position p join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id
                    where p.school_id = c.id and t.scope_level = 'campus' and t.access_type in ('head', 'deputy_head', 'registrar', 'exams_head', 'finance_head', 'student_affairs')
                      and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)), '[]'),
                  'deans', (select count(*) from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = c.id and t.access_type = 'dean' and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)),
                  'heads', (select count(*) from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = c.id and t.access_type = 'dept_head' and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)))
                  order by c.name) from public.school c where c.id in (select public.university_school_ids())), '[]')) end;
$$;
commit;
notify pgrst, 'reload schema';
