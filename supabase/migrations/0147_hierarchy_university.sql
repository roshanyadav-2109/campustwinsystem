-- Hierarchy chart, transfer, nested units, and university-wide positions
-- (roles steps 4 and 5).
--   Units nest (a Director of Engineering over a CS-and-EC group with its own
--   Dean, over the CS and EC departments); a Dean or Director covers every
--   unit and department below them.
--   transfer_position hands a position to someone else in one step.
--   University-wide positions (Vice Chancellor, Registrar, CoE for all
--   campuses) held by the university's central staff count on every campus.
--   Approval chains read in the institution's own titles.
begin;
alter table public.academic_unit add column if not exists parent_id bigint references public.academic_unit(id) on delete set null;
create or replace function public.unit_ancestors(p_unit bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  with recursive up(id, parent_id, depth) as (
    select u.id, u.parent_id, 0 from public.academic_unit u where u.id = p_unit
    union all select u.id, u.parent_id, up.depth + 1 from public.academic_unit u join up on u.id = up.parent_id where up.depth < 20)
  select id from up;
$$;
create or replace function public.unit_descendants(p_unit bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  with recursive down(id, depth) as (
    select p_unit, 0 union all select u.id, down.depth + 1 from public.academic_unit u join down on u.parent_id = down.id where down.depth < 20)
  select id from down;
$$;
grant execute on function public.unit_ancestors(bigint), public.unit_descendants(bigint) to authenticated;
create or replace function public.guard_unit_parent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and (new.parent_id = new.id or new.parent_id in (select public.unit_descendants(new.id))) then
    raise exception 'A unit cannot sit under itself';
  end if;
  if new.parent_id is not null and not exists (select 1 from public.academic_unit where id = new.parent_id and school_id = new.school_id) then
    raise exception 'Unknown parent unit';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_unit_parent on public.academic_unit;
create trigger trg_guard_unit_parent before insert or update of parent_id on public.academic_unit for each row execute function public.guard_unit_parent();

-- a Dean or Director over a unit covers every department below it
create or replace function app.my_dean_departments() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select d.id from app.my_positions_now() p join public.position_title t on t.id = p.title_id
  cross join lateral public.unit_descendants(p.unit_id) du(unit_id)
  join public.department d on d.unit_id = du.unit_id
  where t.access_type = 'dean' and p.unit_id is not null;
$$;

-- university-wide positions held by this person count on every campus of the university
create or replace function app.my_access_types() returns text[]
language sql stable security definer set search_path = '' as $$
  select case when not public.is_higher_ed(public.current_school_id()) then '{}'::text[] else (
    select coalesce(array_agg(distinct t.access_type), '{}')
    from public.staff_position p join public.position_title t on t.id = p.title_id join public.school ps on ps.id = p.school_id
    where p.staff_id = app.my_staff_id()
      and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
      and ((p.school_id = public.current_school_id() and t.scope_level in ('campus', 'university'))
        or (t.scope_level = 'university' and ps.university_id is not null
            and ps.university_id = (select s.university_id from public.school s where s.id = public.current_school_id())))) end;
$$;
-- positions of the whole university that apply here (for "is there a CoE?" and signatures)
create or replace function public.positions_here() returns setof public.staff_position
language sql stable security definer set search_path = '' as $$
  select p.* from public.staff_position p join public.position_title t on t.id = p.title_id join public.school ps on ps.id = p.school_id
  where p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
    and ((p.school_id = public.current_school_id() and t.scope_level in ('campus', 'university'))
      or (t.scope_level = 'university' and ps.university_id is not null
          and ps.university_id = (select s.university_id from public.school s where s.id = public.current_school_id())));
$$;
revoke all on function public.positions_here() from public, anon;
grant execute on function public.positions_here() to authenticated;
create or replace function app.can_publish_results() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_access('exams_head') or ((app.is_office() or app.is_head()) and not exists (
    select 1 from public.positions_here() p join public.position_title t on t.id = p.title_id where t.access_type = 'exams_head'));
$$;
create or replace function public.signatory(p_type text) returns table (title text, name text)
language sql stable security definer set search_path = '' as $$
  select t.name, s.full_name from public.positions_here() p join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id
  where t.access_type = p_type order by (t.scope_level = 'campus') desc, p.acting, p.starts_on limit 1;
$$;

create or replace function public.assign_position(p_staff bigint, p_title bigint, p_unit bigint, p_department bigint, p_programme bigint,
                                                  p_from date, p_to date, p_acting boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); t public.position_title; v_id bigint; p public.staff_position;
begin
  if not public.is_higher_ed(v_school) then raise exception 'Positions are for colleges and universities'; end if;
  if not coalesce(app.is_admin_scope(), false) or app.is_deputy_only() then raise exception 'Only the office or the head can assign positions'; end if;
  select * into t from public.position_title where id = p_title and school_id = v_school and active;
  if t.id is null then raise exception 'Unknown title'; end if;
  -- nobody gives a position to themselves, and only the head gives the top positions
  if p_staff = app.my_staff_id() then raise exception 'Someone else must assign your own positions'; end if;
  -- university-wide positions are given by the university's central administration
  if t.scope_level = 'university' and public.current_university_id() is null and not app.has_access('head') then
    raise exception 'University-wide positions are assigned by the university administration';
  end if;
  if t.access_type = any(app.top_types()) and not app.is_head() then
    raise exception 'Only the head of the institution can assign this position';
  end if;
  if not exists (select 1 from public.staff where id = p_staff and school_id = v_school) then raise exception 'Unknown staff member'; end if;
  if (t.scope_level = 'faculty') <> (p_unit is not null) or (t.scope_level = 'department') <> (p_department is not null) or (t.scope_level = 'programme') <> (p_programme is not null) then
    raise exception 'Choose the % this position is for', t.scope_level;
  end if;
  if (p_unit is not null and not exists (select 1 from public.academic_unit where id = p_unit and school_id = v_school))
     or (p_department is not null and not exists (select 1 from public.department where id = p_department and school_id = v_school))
     or (p_programme is not null and not exists (select 1 from public.programme where id = p_programme and school_id = v_school)) then
    raise exception 'Unknown place';
  end if;
  if exists (select 1 from public.staff_position x where x.staff_id = p_staff and x.title_id = p_title and coalesce(x.unit_id, 0) = coalesce(p_unit, 0)
               and coalesce(x.department_id, 0) = coalesce(p_department, 0) and coalesce(x.programme_id, 0) = coalesce(p_programme, 0)
               and (x.ends_on is null or x.ends_on >= coalesce(p_from, current_date))) then
    raise exception 'This person already holds this position';
  end if;
  insert into public.staff_position (school_id, staff_id, title_id, unit_id, department_id, programme_id, starts_on, ends_on, acting)
  values (v_school, p_staff, p_title, p_unit, p_department, p_programme, coalesce(p_from, (now() at time zone 'Asia/Kolkata')::date), p_to, coalesce(p_acting, false))
  returning * into p;
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  values (v_school, app.my_staff_id(), 'assigned', p_staff, case when p.acting then 'Acting ' else '' end || t.name || coalesce(', ' || public.position_place(p), '') || ' from ' || p.starts_on);
  return p.id;
end $$;

-- hand a position to someone else: the old holder ends the day before, the new one starts that day
alter table public.position_log drop constraint if exists position_log_action_check;
alter table public.position_log add constraint position_log_action_check check (action in ('assigned', 'ended', 'transferred'));
create or replace function public.transfer_position(p_id bigint, p_to_staff bigint, p_on date, p_acting boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare p public.staff_position; t public.position_title; v_on date := coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date); v_new bigint; v_from text;
begin
  select * into p from public.staff_position where id = p_id and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown position'; end if;
  select * into t from public.position_title where id = p.title_id;
  if p_to_staff = p.staff_id then raise exception 'Choose someone else'; end if;
  if t.access_type = any(app.top_types()) and p.staff_id = app.my_staff_id() then raise exception 'Someone else must hand over your own position'; end if;
  select full_name into v_from from public.staff where id = p.staff_id;
  -- the new holder first, so the institution is never without a head
  v_new := public.assign_position(p_to_staff, p.title_id, p.unit_id, p.department_id, p.programme_id, v_on, null, p_acting);
  update public.staff_position set ends_on = greatest(v_on - 1, starts_on) where id = p.id and (ends_on is null or ends_on >= v_on);
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  values (p.school_id, app.my_staff_id(), 'transferred', p_to_staff, t.name || coalesce(', ' || public.position_place(p), '') || ' from ' || coalesce(v_from, '') || ' on ' || v_on);
  return v_new;
end $$;
revoke all on function public.transfer_position(bigint, bigint, date, boolean) from public, anon;
grant execute on function public.transfer_position(bigint, bigint, date, boolean) to authenticated;

-- the hierarchy chart: units (nested), departments, programmes and every current position here
create or replace function public.org_chart() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'parent_id', u.parent_id, 'name', u.name, 'kind', u.kind, 'code', u.code) order by u.name)
                       from public.academic_unit u where u.school_id = public.current_school_id()), '[]'),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'unit_id', d.unit_id, 'name', d.name, 'code', d.code) order by d.name)
                       from public.department d where d.school_id = public.current_school_id()), '[]'),
    'programmes', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'department_id', g.department_id, 'name', g.name) order by g.name)
                       from public.programme g where g.school_id = public.current_school_id()), '[]'),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', t.name, 'type', t.access_type, 'level', t.scope_level, 'sort', t.sort,
                       'staff_id', p.staff_id, 'holder', s.full_name, 'acting', p.acting, 'since', p.starts_on, 'until', p.ends_on,
                       'unit_id', p.unit_id, 'department_id', p.department_id, 'programme_id', p.programme_id,
                       'elsewhere', p.school_id <> public.current_school_id()) order by t.sort, t.name)
                       from (select * from public.positions_here()
                             union select x.* from public.staff_position x where x.school_id = public.current_school_id()
                               and x.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (x.ends_on is null or x.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) p
                       join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id), '[]'))
  where public.is_higher_ed(public.current_school_id()) and app.my_staff_id() is not null;
$$;
revoke all on function public.org_chart() from public, anon;
grant execute on function public.org_chart() to authenticated;

-- approval steps in the institution's own titles ("Head of Department", "Dean", "Vice Chancellor"...)
create or replace function public.chain_labels() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hod', (select name from public.position_title where school_id = public.current_school_id() and access_type = 'dept_head' and active order by sort limit 1),
    'dean', (select name from public.position_title where school_id = public.current_school_id() and access_type = 'dean' and active order by sort limit 1),
    'exams', (select name from public.position_title where school_id = public.current_school_id() and access_type = 'exams_head' and active order by (scope_level = 'campus') desc, sort limit 1),
    'head', coalesce((select t.name from public.positions_here() p join public.position_title t on t.id = p.title_id where t.access_type = 'head' order by (t.scope_level = 'campus') desc limit 1),
                     (select name from public.position_title where school_id = public.current_school_id() and access_type = 'head' and active order by (scope_level = 'campus') desc, sort limit 1)),
    'office', (select name from public.position_title where school_id = public.current_school_id() and access_type = 'registrar' and active order by (scope_level = 'campus') desc, sort limit 1),
    'advisor', (select name from public.position_title where school_id = public.current_school_id() and access_type = 'advisor' and active order by sort limit 1));
$$;
grant execute on function public.chain_labels() to authenticated;

create or replace function public.course_attendance(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, student_name text, subject_id bigint, subject text, held int, attended int, percent numeric, short boolean, condoned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric; v_end date;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
  elsif p_section is null and exists (select 1 from app.my_positions_now()) then null; -- Deans, HoDs and coordinators may see the summary (owner)
  elsif p_section is null or not (coalesce(app.is_admin_scope(), false) or coalesce(p_section in (select app.my_scope_sections()), false) or coalesce(app.ct_of_section(p_section, s.academic_year_id), false) or coalesce(app.teaches_section(p_section, s.academic_year_id), false)) then
    raise exception 'Not allowed';
  end if;
  select attendance_minimum, coalesce(case when attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on) into v_min, v_end from public.school where id = v_school;
  return query
  select a.student_id, st.full_name, a.subject_id, sb.name,
    count(*)::int, count(*) filter (where a.status in ('present', 'late'))::int,
    round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1),
    100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min,
    exists (select 1 from public.attendance_condonation c where c.semester_id = s.id and c.student_id = a.student_id and c.subject_id = a.subject_id)
  from public.attendance_record a
  join public.student st on st.id = a.student_id join public.subject sb on sb.id = a.subject_id
  where a.school_id = v_school and a.period is not null and a.subject_id is not null
    and a.on_date between s.starts_on and v_end
    and (p_section is null or a.section_id = p_section) and (p_student is null or a.student_id = p_student)
  group by a.student_id, st.full_name, a.subject_id, sb.name
  order by st.full_name, sb.name;
end $$;

create or replace function public.relax_step_vacant(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; t text; v_sec bigint; v_dept bigint; v_unit bigint;
begin
  select * into r from public.relaxation_request where id = p_id;
  t := r.chain[r.step + 1];
  if t not in ('hod', 'dean') then return false; end if;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  v_dept := public.section_department(v_sec);
  if v_dept is null then return true; end if;
  select unit_id into v_unit from public.department where id = v_dept;
  return not exists (
    select 1 from public.staff_position p join public.position_title pt on pt.id = p.title_id
    left join public.profile pr on pr.staff_id = p.staff_id and pr.id = r.requested_by
    where p.school_id = r.school_id and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date) and pr.id is null
      and ((t = 'hod' and pt.access_type = 'dept_head' and p.department_id = v_dept)
        or (t = 'dean' and pt.access_type = 'dean' and v_unit is not null and p.unit_id in (select public.unit_ancestors(v_unit)))));
end $$;

create or replace function public.relax_step_staff(p_id bigint) returns setof bigint
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; v_year bigint; v_sec bigint; t text;
begin
  select * into r from public.relaxation_request where id = p_id;
  if r.status <> 'pending' then return; end if;
  t := r.chain[r.step + 1];
  select academic_year_id into v_year from public.semester where id = r.semester_id;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  if t = 'advisor' then
    return query select ta.staff_id from public.teacher_allotment ta where ta.section_id = v_sec and ta.academic_year_id = v_year and ta.is_class_teacher;
  elsif t in ('hod', 'dean') and not public.relax_step_vacant(p_id) then
    return query select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
        and ((t = 'hod' and pt.access_type = 'dept_head' and p.department_id = public.section_department(v_sec))
          or (t = 'dean' and pt.access_type = 'dean' and p.unit_id in (select public.unit_ancestors((select d.unit_id from public.department d where d.id = public.section_department(v_sec))))));
  elsif t = 'exams' then
    return query select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.access_type = 'exams_head' and pt.scope_level in ('campus', 'university')
        and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
  else
    -- a vacant HoD or Dean step goes to the head
    if t in ('hod', 'dean') then t := 'head'; end if;
    return query select st.id from public.staff st where st.school_id = r.school_id and st.role::text = (case t when 'head' then 'principal' else 'office' end)
      union select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.scope_level in ('campus', 'university') and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
        and pt.access_type = any(case t when 'head' then array['head', 'deputy_head'] else array['registrar'] end);
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
