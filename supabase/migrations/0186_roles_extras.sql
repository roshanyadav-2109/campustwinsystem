-- Roles extras (colleges and universities): the finance head works with fees as the office does; a department
-- that teaches courses to other programmes (a service department) sees those students; staff leave goes through
-- the Head of Department and the Dean before the registrar or office; a chart of the whole university.
begin;
-- ---------- finance head ----------
create or replace function app.my_staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select case
    when x.role = 'principal' then x.role
    when x.types && array['head', 'deputy_head'] then 'principal'::public.staff_role
    when x.role = 'office' then x.role
    when x.types && array['registrar', 'finance_head'] then 'office'::public.staff_role
    else x.role end
  from (select s.role, app.my_access_types() types from public.staff s where s.id = app.my_staff_id()) x;
$$;
create or replace function app.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_staff_role() = 'office', false) or coalesce(app.my_base_role() = 'office', false) or app.has_access('registrar') or app.has_access('finance_head');
$$;

-- ---------- service departments ----------
-- the departments a staff member belongs to: their positions, and the courses they teach this year
create or replace function app.staff_departments(p_staff bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  select p.department_id from public.staff_position p where p.staff_id = p_staff and p.department_id is not null
    and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)
  union
  select c.department_id from public.teacher_allotment ta join public.subject sb on sb.id = ta.subject_id join public.course c on c.id = sb.course_id
  where ta.staff_id = p_staff and ta.academic_year_id = app.current_year_id() and c.department_id is not null;
$$;
create or replace function app.my_dept_students() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select e.student_id from public.student_enrollment e
  where exists (select 1 from app.my_positions_now()) and e.status = 'active'
    and e.section_id in (select app.my_scope_sections()) and e.academic_year_id = app.current_year_id()
  union
  -- students of other programmes taking this department's courses this semester
  select rg.student_id from public.course_registration rg join public.programme_course pc on pc.id = rg.programme_course_id
  join public.course c on c.id = pc.course_id join public.semester sm on sm.id = rg.semester_id and sm.is_current
  where exists (select 1 from app.my_positions_now()) and coalesce(rg.status, '') <> 'dropped'
    and (c.department_id in (select app.my_headed_departments()) or c.department_id in (select app.my_dean_departments()));
$$;

-- ---------- staff leave through the Head of Department and the Dean ----------
alter table public.staff_leave add column if not exists steps text[], add column if not exists step text,
  add column if not exists step_log jsonb not null default '[]'::jsonb;
create or replace function public.staff_leave_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_steps text[] := '{}';
begin
  if not public.is_higher_ed(new.school_id) then return new; end if;
  -- a Head of the teacher's department (not the teacher), then a Dean over it, then the registrar or office
  if exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             where t.access_type = 'dept_head' and p.staff_id <> new.staff_id and p.department_id in (select app.staff_departments(new.staff_id))
               and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)) then v_steps := v_steps || 'hod'::text; end if;
  if exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             join public.department d on d.unit_id is not null and d.id in (select app.staff_departments(new.staff_id))
             where t.access_type = 'dean' and p.staff_id <> new.staff_id and p.unit_id is not null
               and d.unit_id in (with recursive up as (select p.unit_id id union all select u.id from public.academic_unit u join up on u.parent_id = up.id) select id from up)
               and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)) then v_steps := v_steps || 'dean'::text; end if;
  new.steps := v_steps || 'final'::text;
  new.step := new.steps[1];
  return new;
end $$;
drop trigger if exists trg_staff_leave_chain on public.staff_leave;
create trigger trg_staff_leave_chain before insert on public.staff_leave for each row execute function public.staff_leave_chain();

-- the final decision (registrar or office) waits for the earlier steps; a refusal may come at any step
create or replace function public.staff_leave_order_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status = 'pending' and old.step is not null and old.step <> 'final' then
    raise exception 'This leave is waiting for the % first', case old.step when 'hod' then 'Head of Department' else 'Dean' end;
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_leave_order on public.staff_leave;
create trigger trg_staff_leave_order before update on public.staff_leave for each row execute function public.staff_leave_order_guard();

create or replace function public.advance_staff_leave(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.staff_leave; v_ok boolean; v_next text;
begin
  select * into l from public.staff_leave where id = p_id and school_id = public.current_school_id() for update;
  if l.id is null or l.status <> 'pending' or l.step is null or l.step = 'final' then raise exception 'Nothing waiting for you here'; end if;
  if l.staff_id = app.my_staff_id() then raise exception 'You cannot decide your own leave'; end if;
  v_ok := case l.step
    when 'hod' then exists (select 1 from app.staff_departments(l.staff_id) d where d in (select app.my_headed_departments()))
    when 'dean' then exists (select 1 from app.staff_departments(l.staff_id) d where d in (select app.my_dean_departments())) end;
  if not coalesce(v_ok, false) then raise exception 'This step is for the % of the teacher''s department', case l.step when 'hod' then 'Head' else 'Dean' end; end if;
  if not p_approve then
    update public.staff_leave set status = 'rejected', decided_by = app.my_staff_id(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 500),
      step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'at', now(), 'ok', false, 'note', left(coalesce(p_note, ''), 200)) where id = l.id;
    return 'rejected';
  end if;
  v_next := l.steps[array_position(l.steps, l.step) + 1];
  update public.staff_leave set step = coalesce(v_next, 'final'),
    step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'at', now(), 'ok', true, 'note', left(coalesce(p_note, ''), 200)) where id = l.id;
  return coalesce(v_next, 'final');
end $$;
revoke all on function public.advance_staff_leave(bigint, boolean, text) from public, anon;
grant execute on function public.advance_staff_leave(bigint, boolean, text) to authenticated;

-- what waits for me (Head of Department or Dean)
create or replace function public.my_leave_steps()
returns table (id bigint, staff_name text, from_date date, to_date date, days numeric, reason text, step text, leave_type text)
language sql stable security definer set search_path = '' as $$
  select l.id, s.full_name, l.from_date, l.to_date, l.days, l.reason, l.step, lt.name
  from public.staff_leave l join public.staff s on s.id = l.staff_id left join public.staff_leave_type lt on lt.id = l.leave_type_id
  where l.school_id = public.current_school_id() and l.status = 'pending' and l.staff_id <> app.my_staff_id()
    and ((l.step = 'hod' and exists (select 1 from app.staff_departments(l.staff_id) d where d in (select app.my_headed_departments())))
      or (l.step = 'dean' and exists (select 1 from app.staff_departments(l.staff_id) d where d in (select app.my_dean_departments()))))
  order by l.from_date;
$$;
revoke all on function public.my_leave_steps() from public, anon;
grant execute on function public.my_leave_steps() to authenticated;

-- ---------- the whole university's chart ----------
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
                  'deans', (select count(*) from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = c.id and t.access_type = 'dean' and (p.ends_on is null or p.ends_on >= current_date)),
                  'heads', (select count(*) from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = c.id and t.access_type = 'dept_head' and (p.ends_on is null or p.ends_on >= current_date)))
                  order by c.name) from public.school c where c.id in (select public.university_school_ids())), '[]')) end;
$$;
revoke all on function public.university_org_chart() from public, anon;
grant execute on function public.university_org_chart() to authenticated;
commit;
notify pgrst, 'reload schema';
