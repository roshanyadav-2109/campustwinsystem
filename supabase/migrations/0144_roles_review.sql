-- Roles step 2, fixes from the product + CTO review.
begin;
-- positions count only at colleges and universities, and are read once per call
create or replace function app.my_access_types() returns text[]
language sql stable security definer set search_path = '' as $$
  select case when not public.is_higher_ed(public.current_school_id()) then '{}'::text[] else (
    select coalesce(array_agg(distinct t.access_type), '{}')
    from public.staff_position p join public.position_title t on t.id = p.title_id
    where p.staff_id = app.my_staff_id() and p.school_id = public.current_school_id() and t.scope_level in ('campus', 'university')
      and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) end;
$$;
create or replace function app.my_base_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$ select s.role from public.staff s where s.id = app.my_staff_id(); $$;
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
-- the head: the principal record, or a head position (not a deputy)
create or replace function app.is_head() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(app.my_base_role() = 'principal', false) or app.has_access('head'); $$;
-- a deputy head with no head, principal or office standing of their own
create or replace function app.is_deputy_only() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_access('deputy_head') and not app.is_head() and coalesce(app.my_base_role() <> 'office', true) and not app.has_access('registrar');
$$;
-- office work: the office record or a registrar position, kept even when a head position makes them principal
create or replace function app.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_staff_role() = 'office', false) or coalesce(app.my_base_role() = 'office', false) or app.has_access('registrar');
$$;
create or replace function app.is_exams() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office() or app.is_head() or app.my_access_types() && array['exams_head', 'exams_deputy', 'exams_staff'];
$$;
create or replace function app.is_exams_lead() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office() or app.is_head() or app.my_access_types() && array['exams_head', 'exams_deputy'];
$$;
create or replace function app.can_publish_results() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_access('exams_head') or ((app.is_office() or app.is_head()) and not exists (
    select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
    where p.school_id = public.current_school_id() and t.access_type = 'exams_head' and t.scope_level in ('campus', 'university')
      and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)));
$$;
grant execute on function app.my_base_role(), app.is_head(), app.is_deputy_only(), app.is_exams_lead() to authenticated;
create or replace function public.my_role_flags() returns table (is_head boolean, deputy_only boolean, can_publish boolean)
language sql stable security definer set search_path = '' as $$ select app.is_head(), app.is_deputy_only(), app.can_publish_results(); $$;
grant execute on function public.my_role_flags() to authenticated;

do $$ declare t text; begin
  foreach t in array array['eval_scheme', 'eval_component', 'eval_grade'] loop
    execute format('drop policy if exists ev_write on public.%I', t);
    execute format('create policy ev_write on public.%I for all to authenticated using ((select app.is_exams_lead())) with check ((select app.is_exams_lead()))', t);
  end loop;
end $$;

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
         when b.bal > 0 then (case when app.is_office() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when b.bal > 0 or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;

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

-- ending: top positions by the head only; never your own top position; never the last head
create or replace function public.end_position(p_id bigint, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.staff_position; t public.position_title; v_on date := coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date);
begin
  if not coalesce(app.is_admin_scope(), false) or app.is_deputy_only() then raise exception 'Only the office or the head can end positions'; end if;
  select * into p from public.staff_position where id = p_id and school_id = public.current_school_id();
  select * into t from public.position_title where id = p.title_id;
  if p.id is null then raise exception 'Unknown position'; end if;
  if t.access_type = any(app.top_types()) then
    if not app.is_head() then raise exception 'Only the head of the institution can end this position'; end if;
    if p.staff_id = app.my_staff_id() then raise exception 'Someone else must end your own position'; end if;
    if t.access_type = 'head' and not exists (select 1 from public.staff s where s.school_id = p.school_id and s.role = 'principal')
       and not exists (select 1 from public.staff_position x join public.position_title xt on xt.id = x.title_id
                       where x.school_id = p.school_id and x.id <> p.id and xt.access_type = 'head' and x.starts_on <= v_on and (x.ends_on is null or x.ends_on > v_on)) then
      raise exception 'The institution would be left without a head. Assign the next head first';
    end if;
  end if;
  update public.staff_position set ends_on = greatest(v_on, starts_on) where id = p_id and (ends_on is null or ends_on > v_on) returning * into p;
  if p.id is null then raise exception 'This position has already ended'; end if;
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  values (p.school_id, app.my_staff_id(), 'ended', p.staff_id, t.name || coalesce(', ' || public.position_place(p), '') || ' on ' || p.ends_on);
end $$;

create or replace function public.guard_top_titles() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if not public.is_higher_ed(public.current_school_id()) then raise exception 'Titles are for colleges and universities'; end if;
    if app.is_deputy_only() then raise exception 'Only the office or the head can change titles'; end if;
    if not app.is_head() and ((tg_op <> 'INSERT' and old.access_type = any(app.top_types())) or (tg_op <> 'DELETE' and new.access_type = any(app.top_types()))) then
      raise exception 'Only the head of the institution can change this title';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- the staff record's role: making or unmaking a principal is for the head only, never on your own record
create or replace function public.guard_staff_role() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and (tg_op = 'INSERT' or new.role is distinct from old.role)
     and (new.role = 'principal' or (tg_op = 'UPDATE' and old.role = 'principal')) then
    if not app.is_head() then raise exception 'Only the head can make or change a principal record'; end if;
    if tg_op = 'UPDATE' and new.id = app.my_staff_id() then raise exception 'Someone else must change your own role'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_staff_role on public.staff;
create trigger trg_guard_staff_role before insert or update of role on public.staff for each row execute function public.guard_staff_role();

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
        and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
  else
    return query select st.id from public.staff st where st.school_id = r.school_id and st.role::text = (case t when 'head' then 'principal' else 'office' end)
      union select p.staff_id from public.staff_position p join public.position_title pt on pt.id = p.title_id
      where p.school_id = r.school_id and pt.scope_level in ('campus', 'university') and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
        and pt.access_type = any(case t when 'head' then array['head', 'deputy_head'] else array['registrar'] end);
  end if;
end $$;

-- who published, in their titles ("Controller of Examinations")
alter table public.semester_result add column if not exists published_as text;
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
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by, published_as)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(v_fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(v_fail_counts, true)), 0), 2),
      null, count(*) filter (where not cr.passed), app.my_staff_id(), public.staff_titles(app.my_staff_id())
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by, published_as = excluded.published_as, published_at = now();
    perform public.recompute_cgpa(r.student_id);
    n := n + 1;
  end loop;
  return n;
end $$;
commit;
notify pgrst, 'reload schema';
