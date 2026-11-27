-- Roles and positions, slice 3: department, faculty and programme scope.
--   Head of Department (dept_head)   -> their department's programmes
--   Dean (faculty)                   -> every department in the faculty
--   Programme Coordinator            -> their programme
-- They read their students, enrolments, registrations and marks; approve
-- course registrations; see the shortage list and the results preview for
-- their sections; raise attendance relaxations; and can be steps in the
-- approval chain ("hod", "dean"). Nothing campus-wide.
begin;
create or replace function app.my_positions_now() returns setof public.staff_position
language sql stable security definer set search_path = '' as $$
  select p.* from public.staff_position p
  where p.staff_id = app.my_staff_id() and p.school_id = public.current_school_id() and public.is_higher_ed(p.school_id)
    and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
$$;
create or replace function app.my_headed_departments() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select p.department_id from app.my_positions_now() p join public.position_title t on t.id = p.title_id
  where t.access_type = 'dept_head' and p.department_id is not null;
$$;
create or replace function app.my_dean_departments() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select d.id from app.my_positions_now() p join public.position_title t on t.id = p.title_id join public.department d on d.unit_id = p.unit_id
  where t.access_type = 'dean' and p.unit_id is not null;
$$;
create or replace function app.my_scope_programmes() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select g.id from public.programme g where g.school_id = public.current_school_id()
    and (g.department_id in (select app.my_headed_departments()) or g.department_id in (select app.my_dean_departments()))
  union
  select p.programme_id from app.my_positions_now() p join public.position_title t on t.id = p.title_id
  where t.access_type = 'programme_coord' and p.programme_id is not null;
$$;
create or replace function app.my_scope_sections() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select sec.id from public.section sec join public.class c on c.id = sec.class_id where c.programme_id in (select app.my_scope_programmes());
$$;
create or replace function app.my_dept_students() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select e.student_id from public.student_enrollment e
  where e.section_id in (select app.my_scope_sections()) and e.academic_year_id = app.current_year_id();
$$;
-- the department of a section (through its programme)
create or replace function public.section_department(p_section bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select g.department_id from public.section sec join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id where sec.id = p_section;
$$;
grant execute on function app.my_positions_now(), app.my_headed_departments(), app.my_dean_departments(), app.my_scope_programmes(), app.my_scope_sections(), app.my_dept_students() to authenticated;
grant execute on function public.section_department(bigint) to authenticated;

-- the sections a scoped person may open, for the screens
create or replace function public.my_scope_sections() returns table (id bigint, label text)
language sql stable security definer set search_path = '' as $$
  select sec.id, c.name || '-' || sec.name from public.section sec join public.class c on c.id = sec.class_id
  where sec.id in (select app.my_scope_sections()) order by c.level, c.name, sec.name;
$$;
grant execute on function public.my_scope_sections() to authenticated;

-- reading their own students
do $$ declare t text; begin
  foreach t in array array['student', 'student_enrollment'] loop
    execute format('drop policy if exists scope_read on public.%I', t);
  end loop;
end $$;
create policy scope_read on public.student for select to authenticated using (id in (select app.my_dept_students()));
create policy scope_read on public.student_enrollment for select to authenticated using (student_id in (select app.my_dept_students()));
drop policy if exists scope_read on public.assessment;
create policy scope_read on public.assessment for select to authenticated using (section_id in (select app.my_scope_sections()));
drop policy if exists scope_read on public.mark;
create policy scope_read on public.mark for select to authenticated using (student_id in (select app.my_dept_students()));
drop policy if exists scope_read on public.course_registration;
create policy scope_read on public.course_registration for select to authenticated using (student_id in (select app.my_dept_students()));

-- approving registrations: the office, or the HoD / Dean / coordinator of the student's programme
create or replace function public.approve_registrations(p_semester bigint, p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  with u as (update public.course_registration r set status = 'approved'
             where r.semester_id = p_semester and r.id = any(p_ids) and r.status = 'registered' and r.school_id = public.current_school_id()
               and (coalesce(app.is_office(), false) or r.student_id in (select app.my_dept_students()))
             returning 1)
  select count(*)::int from u;
$$;

create or replace function public.compute_course_results(p_semester bigint, p_section bigint)
returns table (student_id bigint, student_name text, roll_no int, course_id bigint, course_code text, course_name text, credits numeric,
               cia numeric, cia_max numeric, ese numeric, ese_max numeric, percent numeric, grade text, point numeric, passed boolean, status text)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_term smallint;
begin
  select * into s from public.semester where id = p_semester and school_id = v_school;
  if s.id is null or s.kind not in ('odd', 'even') then raise exception 'Choose an odd or even semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (coalesce(app.is_admin_scope(), false) or app.is_exams() or p_section in (select app.my_scope_sections()) or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then raise exception 'Not allowed'; end if;
  v_term := case when s.kind = 'odd' then 1 else 2 end;
  return query
  with regs as (
    select r.student_id sid, st.full_name, e.roll_no::int roll, pc.course_id, c.code, c.name cname, c.credits, p.eval_scheme_id sch
    from public.course_registration r
    join public.programme_course pc on pc.id = r.programme_course_id
    join public.programme p on p.id = pc.programme_id
    join public.course c on c.id = pc.course_id
    join public.student st on st.id = r.student_id
    join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = s.academic_year_id and e.section_id = p_section
    where r.semester_id = p_semester and r.status <> 'dropped'),
  comps as (select comp.*, g.sid, g.course_id from regs g join public.eval_component comp on comp.scheme_id = g.sch),
  -- the tests a student sat for the course: this section's, or any section where they have a mark
  tests as (
    select k.sid, k.course_id, k.id comp_id, a.id aid, a.max_marks
    from comps k
    join public.subject sb on sb.course_id = k.course_id and sb.school_id = v_school
    join public.assessment a on a.subject_id = sb.id and a.academic_year_id = s.academic_year_id and a.term = v_term and a.assessment_type_id = k.assessment_type_id
    where a.section_id = p_section or exists (select 1 from public.mark mm where mm.assessment_id = a.id and mm.student_id = k.sid)),
  comp_scores as (
    select k.sid, k.course_id, k.id comp_id, k.part, k.rule, k.best_n, k.weight,
      count(t.aid) n_tests,
      count(t.aid) filter (where m.id is null) n_missing,
      count(t.aid) filter (where m.is_exempt) n_exempt,
      count(t.aid) filter (where m.id is not null and not m.is_exempt) n_held,
      count(t.aid) filter (where m.is_absent and not m.is_exempt) n_absent,
      coalesce(sum(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained, t.max_marks) end) filter (where m.id is not null and not m.is_exempt), 0) obt,
      coalesce(sum(t.max_marks) filter (where m.id is not null and not m.is_exempt), 0) poss,
      array_agg(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained / nullif(t.max_marks, 0), 1) end)
        filter (where m.id is not null and not m.is_exempt) fr
    from comps k left join tests t on t.sid = k.sid and t.course_id = k.course_id and t.comp_id = k.id
    left join public.mark m on m.assessment_id = t.aid and m.student_id = k.sid
    group by k.sid, k.course_id, k.id, k.part, k.rule, k.best_n, k.weight),
  scored as (
    select cs.*,
      (cs.n_tests > 0 and cs.n_exempt = cs.n_tests) fully_exempt,
      case when cs.n_held = 0 then null
           when cs.rule = 'sum' then cs.obt / nullif(cs.poss, 0) * cs.weight
           when cs.rule = 'average' then (select avg(x) from unnest(cs.fr) x) * cs.weight
           else coalesce((select sum(x) from (select x from unnest(cs.fr) x order by x desc limit cs.best_n) b), 0) / least(cs.best_n, cs.n_held) * cs.weight end score
    from comp_scores cs),
  parts as (
    select sc.sid, sc.course_id,
      sum(sc.score) filter (where sc.part = 'cia' and not sc.fully_exempt) cia,
      sum(sc.weight) filter (where sc.part = 'cia' and not sc.fully_exempt) cia_max,
      sum(sc.score) filter (where sc.part = 'ese' and not sc.fully_exempt) ese,
      sum(sc.weight) filter (where sc.part = 'ese' and not sc.fully_exempt) ese_max,
      bool_or(not sc.fully_exempt and (sc.n_tests = 0 or sc.n_missing > 0)) incomplete,
      bool_or(sc.part = 'ese' and not sc.fully_exempt and sc.n_held > 0 and sc.n_absent = sc.n_held) ese_absent
    from scored sc group by sc.sid, sc.course_id)
  select g.sid, g.full_name, g.roll, g.course_id, g.code, g.cname, g.credits,
    round(pt.cia, 2), pt.cia_max, round(pt.ese, 2), pt.ese_max,
    r.pct,
    case when pt.ese_absent then 'Ab' when r.ok then coalesce(gr.grade, 'P') else 'F' end,
    case when r.ok then coalesce(gr.point, 0) else 0 end,
    r.ok,
    case when g.sch is null then 'no_scheme' when pt.sid is null or pt.incomplete then 'incomplete' when pt.ese_absent then 'absent' when r.ok then 'pass' else 'fail' end
  from regs g
  left join parts pt on pt.sid = g.sid and pt.course_id = g.course_id
  left join public.eval_scheme es on es.id = g.sch
  left join lateral (
    select round((coalesce(pt.cia, 0) + coalesce(pt.ese, 0)) / nullif(coalesce(pt.cia_max, 0) + coalesce(pt.ese_max, 0), 0) * 100, 2) pct,
           round(coalesce(pt.ese, 0) / nullif(pt.ese_max, 0) * 100, 2) ese_pct) p0 on true
  left join lateral (
    select p0.pct, coalesce(not pt.ese_absent, true) and p0.pct is not null and p0.pct >= es.pass_percent
      and (es.ese_min_percent is null or pt.ese_max is null or coalesce(p0.ese_pct, 0) >= es.ese_min_percent) ok) r on true
  left join lateral (
    select eg.grade, eg.point from public.eval_grade eg where eg.scheme_id = g.sch and r.pct is not null and eg.min_percent <= r.pct order by eg.min_percent desc limit 1) gr on true
  order by g.roll nulls last, g.full_name, g.code;
end $$;

create or replace function public.course_attendance(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, student_name text, subject_id bigint, subject text, held int, attended int, percent numeric, short boolean, condoned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric; v_end date;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
  elsif not (coalesce(app.is_admin_scope(), false) or p_section in (select app.my_scope_sections()) or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then
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

create or replace function public.request_relaxation(p_kind text, p_student bigint, p_subject bigint, p_section bigint, p_date date, p_until date, p_reason text, p_override boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_id bigint; v_pct numeric; v_chain text[]; v_sec bigint;
begin
  select * into sc from public.school where id = v_school;
  if not public.is_higher_ed(v_school) then raise exception 'For colleges and universities'; end if;
  if app.my_staff_id() is null then raise exception 'Only staff can ask for a relaxation'; end if;
  if p_override and not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can approve directly'; end if;
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then raise exception 'No current semester'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  select array_agg(x) into v_chain from jsonb_array_elements_text(coalesce(sc.relax_chain -> p_kind, '["head"]'::jsonb)) x;
  if p_kind = 'unlock' then
    if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, s.academic_year_id)
            or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
      raise exception 'Only the teacher of this course can ask';
    end if;
    if public.lecture_lock_reason(p_section, p_subject, p_date) is null then raise exception 'This day is not locked'; end if;
    insert into public.relaxation_request (kind, semester_id, subject_id, section_id, on_date, reason, chain)
    values ('unlock', s.id, p_subject, p_section, p_date, left(trim(p_reason), 300), v_chain) returning id into v_id;
  elsif p_kind in ('attendance', 'fees') then
    v_sec := public.section_in_semester(p_student, s.id);
    if v_sec is null or not exists (select 1 from public.student where id = p_student and school_id = v_school) then raise exception 'Unknown student'; end if;
    if p_kind = 'attendance' then
      if p_subject is null then raise exception 'Choose the course'; end if;
      if not (coalesce(app.is_admin_scope(), false) or v_sec in (select app.my_scope_sections()) or app.ct_of_section(v_sec, s.academic_year_id)
              or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = v_sec and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
        raise exception 'Only the course teacher, the class teacher or the office can ask';
      end if;
      select round(100.0 * count(*) filter (where a.status in ('present', 'late')) / nullif(count(*), 0), 1) into v_pct
        from public.attendance_record a where a.student_id = p_student and a.subject_id = p_subject and a.period is not null
         and a.on_date between s.starts_on and coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on);
      if v_pct is null or v_pct >= sc.attendance_minimum then raise exception 'Attendance in this course is not short'; end if;
      if sc.condone_floor is not null and v_pct < sc.condone_floor then
        raise exception 'Attendance is % %%, below % %%: it cannot be relaxed', v_pct, sc.condone_floor;
      end if;
    else
      if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office can ask for a fee extension'; end if;
      if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date or p_until > (now() at time zone 'Asia/Kolkata')::date + 120 then
        raise exception 'Give the date by which the fees will be paid (within 120 days)';
      end if;
    end if;
    insert into public.relaxation_request (kind, semester_id, student_id, subject_id, until, reason, chain)
    values (p_kind, s.id, p_student, case when p_kind = 'attendance' then p_subject end, case when p_kind = 'fees' then p_until end, left(trim(p_reason), 300), v_chain)
    returning id into v_id;
  else
    raise exception 'Unknown request';
  end if;
  if p_override then
    insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
    values (v_school, v_id, 1, 'override', app.my_staff_id(), 'approved', 'Approved directly');
    perform public.relax_apply(v_id);
  else
    perform public.relax_notify(v_id);
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting for approval';
end $$;

create or replace function public.relax_chain_ok(c jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(c) = 'object' and c ? 'attendance' and c ? 'fees' and c ? 'unlock'
     and (select bool_and(k in ('attendance', 'fees', 'unlock')
                          and jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 5
                          and (select bool_and(x in ('advisor', 'hod', 'dean', 'head', 'office', 'exams')) and count(distinct x) = count(*) from jsonb_array_elements_text(v) x))
          from jsonb_each(c) e(k, v));
$$;
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
                when 'hod' then public.section_department(v_sec) in (select app.my_headed_departments())
                when 'dean' then public.section_department(v_sec) in (select app.my_dean_departments())
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
  elsif t in ('hod', 'dean') then
    return query select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
        and ((t = 'hod' and pt.access_type = 'dept_head' and p.department_id = public.section_department(v_sec))
          or (t = 'dean' and pt.access_type = 'dean' and p.unit_id = (select d.unit_id from public.department d where d.id = public.section_department(v_sec))));
  elsif t = 'exams' then
    return query select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.access_type = 'exams_head' and pt.scope_level in ('campus', 'university')
        and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
  else
    return query select st.id from public.staff st where st.school_id = r.school_id and st.role::text = (case t when 'head' then 'principal' else 'office' end)
      union select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.scope_level in ('campus', 'university') and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
        and pt.access_type = any(case t when 'head' then array['head', 'deputy_head'] else array['registrar'] end);
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
