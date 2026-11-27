-- Roles and positions, slice 2: campus-wide positions give access.
--   head, deputy head  -> everything the principal has
--   registrar          -> everything the office has
--   examinations head, deputy, exam section -> the exam cell: exam timetable,
--     hall tickets, evaluation schemes, results; only the examinations head
--     publishes results (the registrar or office where there is none)
-- The staff record's own role stays the base; positions only add to it. Only
-- the head assigns the top positions or turns a title into one; nobody
-- assigns their own.
begin;
-- current campus-wide access types of the signed-in staff member
create or replace function app.my_access_types() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct t.access_type), '{}')
  from public.staff_position p join public.position_title t on t.id = p.title_id
  where p.staff_id = app.my_staff_id() and p.school_id = public.current_school_id() and t.scope_level in ('campus', 'university')
    and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
$$;
create or replace function app.has_access(p_type text) returns boolean
language sql stable security definer set search_path = '' as $$ select p_type = any(app.my_access_types()); $$;
create or replace function app.top_types() returns text[] language sql immutable as $$
  select array['governing', 'head', 'deputy_head', 'registrar', 'exams_head', 'finance_head'];
$$;

-- the role every existing check uses now follows positions
create or replace function app.my_staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select case
    when s.role = 'principal' then s.role
    when app.my_access_types() && array['head', 'deputy_head'] then 'principal'::public.staff_role
    when s.role = 'office' then s.role
    when 'registrar' = any(app.my_access_types()) then 'office'::public.staff_role
    else s.role end
  from public.staff s where s.id = app.my_staff_id();
$$;

create or replace function app.is_exams() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_office(), false) or app.my_access_types() && array['exams_head', 'exams_deputy', 'exams_staff'];
$$;
-- publishing: the examinations head; the office (or registrar) only where the campus has none
create or replace function app.can_publish_results() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_access('exams_head') or (coalesce(app.is_office(), false) and not exists (
    select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
    where p.school_id = public.current_school_id() and t.access_type = 'exams_head' and t.scope_level in ('campus', 'university')
      and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)));
$$;
create or replace function public.can_publish_results() returns boolean language sql stable security definer set search_path = '' as $$ select app.can_publish_results(); $$;
create or replace function public.my_access_types() returns text[] language sql stable security definer set search_path = '' as $$ select app.my_access_types(); $$;
grant execute on function app.my_access_types(), app.has_access(text), app.top_types(), app.is_exams(), app.can_publish_results() to authenticated;
grant execute on function public.can_publish_results(), public.my_access_types() to authenticated;

-- the exam cell writes the exam timetable and evaluation schemes
drop policy if exists es_write on public.exam_session;
create policy es_write on public.exam_session for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams()));
drop policy if exists ep_write on public.exam_paper;
create policy ep_write on public.exam_paper for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams()));
do $$ declare t text; begin
  foreach t in array array['eval_scheme', 'eval_component', 'eval_grade'] loop
    execute format('drop policy if exists ev_write on public.%I', t);
    execute format('create policy ev_write on public.%I for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams()))', t);
  end loop;
end $$;
drop policy if exists crr_read on public.course_result_revision;
create policy crr_read on public.course_result_revision for select to authenticated using ((select app.is_admin_scope()) or (select app.is_exams()));

create or replace function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text, subject_ids bigint[])
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date; v_he boolean; v_sem public.semester; v_min numeric;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.is_exams() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not (app.is_admin_scope() or app.is_exams()) and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.is_exams() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  v_he := public.is_higher_ed(v_school);
  select * into v_sem from public.semester where school_id = v_school and is_current;
  select attendance_minimum into v_min from public.school where id = v_school;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, e.roll_no::int roll, c.name || '-' || sec.name cls, st.photo_path, ac.verify_token tok,
      case when v_s.withhold_fee_dues and not public.fee_relaxed(st.id, coalesce(v_first, current_date)) then public.overdue_fees(st.id, coalesce(v_first, current_date)) else 0 end bal,
      case when v_he and v_sem.id is not null then (
        select array_agg(distinct sb.id) from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
        join public.subject sb on sb.course_id = pc.course_id and sb.school_id = v_school
        where r.semester_id = v_sem.id and r.student_id = st.id and r.status <> 'dropped') end subj,
      case when v_he and v_sem.id is not null then public.attendance_shortage(st.id, v_sem.id) end short
    from public.student_enrollment e
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
    where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student))
  select b.sid, b.full_name, b.admission_no, b.roll, b.cls, b.photo_path,
    b.bal > 0 or b.short is not null,
    case when b.short is not null then 'Attendance below ' || v_min || '% in ' || b.short
         when b.bal > 0 then (case when app.is_office() or app.is_exams() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when b.bal > 0 or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;

create or replace function public.compute_course_results(p_semester bigint, p_section bigint)
returns table (student_id bigint, student_name text, roll_no int, course_id bigint, course_code text, course_name text, credits numeric,
               cia numeric, cia_max numeric, ese numeric, ese_max numeric, percent numeric, grade text, point numeric, passed boolean, status text)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_term smallint;
begin
  select * into s from public.semester where id = p_semester and school_id = v_school;
  if s.id is null or s.kind not in ('odd', 'even') then raise exception 'Choose an odd or even semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (coalesce(app.is_admin_scope(), false) or app.is_exams() or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then raise exception 'Not allowed'; end if;
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

create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int := 0; r record; v_sem public.semester; v_fail_counts boolean;
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  for r in
    select c.student_id, bool_and(c.status in ('pass', 'fail', 'absent')) complete,
           exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = c.student_id) done
    from public.compute_course_results(p_semester, p_section) c group by c.student_id
  loop
    continue when not r.complete;
    continue when r.done and coalesce(trim(p_revise_reason), '') = '';
    if r.done then
      insert into public.course_result_revision (school_id, revised_by, reason, old)
      select v_school, app.my_staff_id(), left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1;
      delete from public.course_result where semester_id = p_semester and student_id = r.student_id and attempt = 1;
    end if;
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
    from public.compute_course_results(p_semester, p_section) c where c.student_id = r.student_id;
    select coalesce(es.fail_counts_in_gpa, true) into v_fail_counts
      from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
      join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
     where e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id limit 1;
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(v_fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(v_fail_counts, true)), 0), 2),
      null, count(*) filter (where not cr.passed), app.my_staff_id()
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by, published_at = now();
    perform public.recompute_cgpa(r.student_id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.withhold_result(p_semester bigint, p_student bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(app.is_office(), false) or app.is_exams()) then raise exception 'Only the office or the exam cell can hold back results'; end if;
  update public.semester_result set withheld_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
   where semester_id = p_semester and student_id = p_student and school_id = public.current_school_id();
end $$;

-- approvers: the examinations head can be a step ("exams")
create or replace function public.relax_chain_ok(c jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(c) = 'object' and c ? 'attendance' and c ? 'fees' and c ? 'unlock'
     and (select bool_and(k in ('attendance', 'fees', 'unlock')
                          and jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 4
                          and (select bool_and(x in ('advisor', 'head', 'office', 'exams')) and count(distinct x) = count(*) from jsonb_array_elements_text(v) x))
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
  elsif t = 'exams' then
    return query select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.access_type = 'exams_head' and pt.scope_level in ('campus', 'university')
        and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date);
  else
    return query select st.id from public.staff st where st.school_id = r.school_id and st.role::text = (case t when 'head' then 'principal' else 'office' end)
      union select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.scope_level in ('campus', 'university') and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)
        and pt.access_type = any(case t when 'head' then array['head', 'deputy_head'] else array['registrar'] end);
  end if;
end $$;

create or replace function public.assign_position(p_staff bigint, p_title bigint, p_unit bigint, p_department bigint, p_programme bigint,
                                                  p_from date, p_to date, p_acting boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); t public.position_title; v_id bigint; p public.staff_position;
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can assign positions'; end if;
  select * into t from public.position_title where id = p_title and school_id = v_school and active;
  if t.id is null then raise exception 'Unknown title'; end if;
  -- nobody gives a position to themselves, and only the head gives the top positions
  if p_staff = app.my_staff_id() then raise exception 'Someone else must assign your own positions'; end if;
  if t.access_type = any(app.top_types()) and not coalesce(app.is_principal(), false) then
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

-- turning a title into a top position (or editing one) is for the head only
create or replace function public.guard_top_titles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_user = 'authenticated' and not coalesce(app.is_principal(), false)
     and ((tg_op <> 'INSERT' and old.access_type = any(app.top_types())) or (tg_op <> 'DELETE' and new.access_type = any(app.top_types()))) then
    raise exception 'Only the head of the institution can change this title';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_top_titles on public.position_title;
create trigger trg_guard_top_titles before insert or update or delete on public.position_title for each row execute function public.guard_top_titles();
commit;
notify pgrst, 'reload schema';
