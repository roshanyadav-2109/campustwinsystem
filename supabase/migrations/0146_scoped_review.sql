-- Roles step 3, fixes from the product + CTO review.
begin;
-- only people who hold a position pay for the scope lookup; active enrolments only
create or replace function app.my_scope_programmes() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select g.id from public.programme g where exists (select 1 from app.my_positions_now()) and g.school_id = public.current_school_id()
    and (g.department_id in (select app.my_headed_departments()) or g.department_id in (select app.my_dean_departments()))
  union
  select p.programme_id from app.my_positions_now() p join public.position_title t on t.id = p.title_id
  where t.access_type = 'programme_coord' and p.programme_id is not null;
$$;
create or replace function app.my_dept_students() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select e.student_id from public.student_enrollment e
  where exists (select 1 from app.my_positions_now()) and e.status = 'active'
    and e.section_id in (select app.my_scope_sections()) and e.academic_year_id = app.current_year_id();
$$;
create or replace function public.my_scope_programmes() returns table (id bigint) language sql stable security definer set search_path = '' as $$ select app.my_scope_programmes(); $$;
grant execute on function public.my_scope_programmes() to authenticated;

-- approving: the student's section in that semester must be in the lead's scope
create or replace function public.approve_registrations(p_semester bigint, p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  with u as (update public.course_registration r set status = 'approved'
             where r.semester_id = p_semester and r.id = any(p_ids) and r.status = 'registered' and r.school_id = public.current_school_id()
               and (coalesce(app.is_office(), false) or coalesce(public.section_in_semester(r.student_id, r.semester_id) in (select app.my_scope_sections()), false))
             returning 1)
  select count(*)::int from u;
$$;

-- an HoD or Dean step with nobody to take it (no one holds it, or only the person who asked) goes to the head
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
        or (t = 'dean' and pt.access_type = 'dean' and v_unit is not null and p.unit_id = v_unit)));
end $$;
revoke all on function public.relax_step_vacant(bigint) from public, anon, authenticated;

create or replace function public.course_attendance(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, student_name text, subject_id bigint, subject text, held int, attended int, percent numeric, short boolean, condoned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric; v_end date;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
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

create or replace function public.relax_can_act(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; t text; v_year bigint; v_sec bigint;
begin
  select * into r from public.relaxation_request where id = p_id and school_id = public.current_school_id();
  if r.id is null or r.status <> 'pending' or r.requested_by = auth.uid() then return false; end if;
  t := r.chain[r.step + 1];
  select academic_year_id into v_year from public.semester where id = r.semester_id;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  return case t when 'advisor' then coalesce(app.ct_of_section(v_sec, v_year), false)
                when 'office' then coalesce(app.is_office(), false)
                when 'head' then coalesce(app.is_principal(), false)
                when 'exams' then app.has_access('exams_head')
                when 'hod' then case when public.relax_step_vacant(p_id) then coalesce(app.is_head(), false) else coalesce(public.section_department(v_sec) in (select app.my_headed_departments()), false) end
                when 'dean' then case when public.relax_step_vacant(p_id) then coalesce(app.is_head(), false) else coalesce(public.section_department(v_sec) in (select app.my_dean_departments()), false) end
                else false end;
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
          or (t = 'dean' and pt.access_type = 'dean' and p.unit_id = (select d.unit_id from public.department d where d.id = public.section_department(v_sec))));
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
