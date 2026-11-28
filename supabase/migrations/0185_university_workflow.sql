-- University: transfer requests approved centrally with a transfer order and a course-equivalence mapping;
-- the catalogue pushed with updates; a common exam timetable copied to other campuses.
begin;
-- ---------- transfer requests: asked by the campus (or the family), approved centrally, with an order ----------
create table if not exists public.transfer_request (
  id            bigint generated always as identity primary key,
  university_id bigint not null references public.university(id) on delete cascade,
  from_school   bigint not null references public.school(id) on delete cascade,
  student_id    bigint not null references public.student(id) on delete cascade,
  to_school     bigint not null references public.school(id) on delete cascade,
  reason        text check (reason is null or char_length(reason) <= 300),
  status        text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'withdrawn')),
  order_no      text,
  transfer_id   bigint references public.student_transfer(id) on delete set null,
  requested_by  uuid,
  decided_by    uuid,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create unique index if not exists uq_transfer_request_open on public.transfer_request (student_id) where status = 'requested';
create unique index if not exists uq_transfer_order on public.transfer_request (university_id, order_no) where order_no is not null;
alter table public.transfer_request enable row level security;
drop policy if exists tq_read on public.transfer_request;
create policy tq_read on public.transfer_request for select to authenticated
  using (university_id = (select public.current_university_id())
     or (from_school = (select public.current_school_id()) and ((select coalesce(app.is_admin_scope(), false)) or app.owns_student(student_id)))
     or (to_school = (select public.current_school_id()) and (select coalesce(app.is_admin_scope(), false))));
revoke all on public.transfer_request from anon, authenticated;
grant select on public.transfer_request to authenticated;
grant all on public.transfer_request to service_role;

create or replace function public.request_campus_transfer(p_student bigint, p_to bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_uni bigint; v_id bigint;
begin
  if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.student where id = p_student and school_id = v_school and status = 'active') then raise exception 'Unknown student'; end if;
  select university_id into v_uni from public.school where id = v_school;
  if v_uni is null or p_to = v_school or not exists (select 1 from public.school where id = p_to and university_id = v_uni) then raise exception 'Choose another campus of the university'; end if;
  insert into public.transfer_request (university_id, from_school, student_id, to_school, reason, requested_by)
  values (v_uni, v_school, p_student, p_to, left(nullif(trim(p_reason), ''), 300), auth.uid()) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'A transfer request for this student is already waiting';
end $$;
revoke all on function public.request_campus_transfer(bigint, bigint, text) from public, anon;
grant execute on function public.request_campus_transfer(bigint, bigint, text) to authenticated;

-- the courses the student has results in, and the matching course at the new campus (same code), for central administration to map
create or replace function public.transfer_mapping(p_from_student bigint, p_to bigint)
returns table (from_course_id bigint, code text, name text, credits numeric, grade text, suggested bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (c.id) c.id, c.code, c.name, cr.credits, cr.grade,
    (select tc.id from public.course tc where tc.school_id = p_to and tc.code = c.code limit 1)
  from public.course_result cr join public.course c on c.id = cr.course_id join public.student s on s.id = cr.student_id
  where cr.student_id = p_from_student and app.is_central_for(s.school_id) and app.is_central_for(p_to) and cr.counts
  order by c.id, cr.attempt desc;
$$;
revoke all on function public.transfer_mapping(bigint, bigint) from public, anon;
grant execute on function public.transfer_mapping(bigint, bigint) to authenticated;

create or replace function public.campus_courses(p_school bigint)
returns table (id bigint, code text, name text, credits numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.name, c.credits from public.course c where c.school_id = p_school and app.is_central_for(p_school) order by c.code;
$$;
revoke all on function public.campus_courses(bigint) from public, anon;
grant execute on function public.campus_courses(bigint) to authenticated;

create or replace function public.decide_transfer_request(p_id bigint, p_approve boolean, p_section bigint, p_map jsonb, p_note text, p_allow_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.transfer_request; j jsonb; v_no text; v_yr text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
begin
  select * into r from public.transfer_request where id = p_id for update;
  if r.id is null or r.status <> 'requested' then raise exception 'No waiting request'; end if;
  if not app.is_central_for(r.from_school) then raise exception 'Only central administration decides transfers'; end if;
  if not p_approve then
    update public.transfer_request set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300) where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;
  j := public.transfer_student(r.from_school, (select admission_no from public.student where id = r.student_id), r.to_school, p_section, coalesce(p_note, r.reason), p_allow_partial, p_map);
  perform pg_advisory_xact_lock(hashtext('transfer-order'), r.university_id::int);
  select 'TO-' || v_yr || '-' || lpad((coalesce(max(nullif(split_part(order_no, '-', 3), '')::int), 0) + 1)::text, 4, '0') into v_no
    from public.transfer_request where university_id = r.university_id and order_no like 'TO-' || v_yr || '-%';
  update public.transfer_request set status = 'approved', order_no = v_no, decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300),
         transfer_id = (select id from public.student_transfer where from_student = r.student_id order by id desc limit 1) where id = r.id;
  return j || jsonb_build_object('order_no', v_no);
end $$;
revoke all on function public.decide_transfer_request(bigint, boolean, bigint, jsonb, text, boolean) from public, anon;
grant execute on function public.decide_transfer_request(bigint, boolean, bigint, jsonb, text, boolean) to authenticated;

drop function if exists public.transfer_student(bigint, text, bigint, bigint, text, boolean);
create function public.transfer_student(p_from bigint, p_admission_no text, p_to bigint, p_section bigint, p_note text default null, p_allow_partial boolean default false, p_map jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.student; v_new bigint; v_adm text; v_year bigint; v_carried int; v_missing text; v_uni bigint; g record; v_g bigint; v_dues text; v_i int := 1;
  v_from_prog text; v_to_prog text; v_before numeric; v_after numeric;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can transfer between two of its campuses'; end if;
  select * into s from public.student where school_id = p_from and admission_no = trim(p_admission_no) for update;
  if s.id is null then raise exception 'No student with that admission number at this campus'; end if;
  if s.status <> 'active' then raise exception 'This student is not studying here now'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = p_to) then raise exception 'Choose a section at the new campus'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'The new campus has no current academic year'; end if;
  -- the same programme
  select pg.code into v_from_prog from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme pg on pg.id = c.programme_id where e.student_id = s.id and e.status = 'active' limit 1;
  select pg.code into v_to_prog from public.section sec join public.class c on c.id = sec.class_id join public.programme pg on pg.id = c.programme_id where sec.id = p_section;
  if v_from_prog is not null and v_to_prog is distinct from v_from_prog then raise exception 'A transfer keeps the programme: choose a % section at the new campus', v_from_prog; end if;
  -- nothing left open at this campus
  select string_agg(x, '; ') into v_dues from (
    select 'fees due' x where exists (select 1 from public.fee_invoice i where i.student_id = s.id and i.status in ('due', 'part'))
    union all select 'library books not returned' where exists (select 1 from public.library_issue l where l.student_id = s.id and l.returned_on is null)
    union all select 'hostel room not vacated' where exists (select 1 from public.hostel_allocation h where h.student_id = s.id and (h.to_date is null or h.to_date >= current_date))
    union all select 'malpractice report open' where exists (select 1 from public.exam_incident i where i.student_id = s.id and i.status = 'open')
    union all select 'revaluation pending' where exists (select 1 from public.reval_request r where r.student_id = s.id and r.status = 'pending')
    union all select 'supplementary exam pending' where exists (select 1 from public.supp_registration r where r.student_id = s.id and r.status in ('pending', 'registered') and r.result_id is null)
    union all select 'answer scripts still in valuation' where exists (select 1 from public.exam_script x where x.student_id = s.id and x.status <> 'decoded')) d;
  if v_dues is not null then raise exception 'Clear these at this campus first: %', v_dues; end if;
  -- grades that cannot be carried: refuse unless asked to go ahead (CGPA would change)
  select string_agg(distinct fc.code || coalesce(' (' || fy.name || ')', ''), ', ') into v_missing
  from public.course_result cr join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  where cr.student_id = s.id and (coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id and exists (select 1 from public.course cx where cx.id = (mm ->> 'to_course_id')::bigint and cx.school_id = p_to) limit 1), (select tc0.id from public.course tc0 where tc0.school_id = p_to and tc0.code = fc.code limit 1)) is null
     or not exists (select 1 from public.academic_year ty join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind where ty.school_id = p_to and ty.name = fy.name));
  if v_missing is not null and not coalesce(p_allow_partial, false) then
    raise exception 'These results have no matching course or semester at the new campus, so CGPA would change: %. Copy the catalogue first, or transfer anyway.', left(v_missing, 300);
  end if;
  select cgpa into v_before from public.student_standing(s.id);
  select university_id into v_uni from public.school where id = p_from;

  v_adm := s.admission_no;
  while exists (select 1 from public.student where school_id = p_to and admission_no = v_adm) loop
    v_adm := left(s.admission_no, 24) || '-TR' || case when v_i > 1 then v_i::text else '' end; v_i := v_i + 1;
  end loop;
  insert into public.student (school_id, admission_no, full_name, dob, gender, photo_path, email, phone, status, university_reg_no)
  values (p_to, v_adm, s.full_name, s.dob, s.gender, s.photo_path, s.email, s.phone, 'active', s.university_reg_no) returning id into v_new;
  insert into public.student_identity (student_id, school_id, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl)
  select v_new, p_to, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl from public.student_identity where student_id = s.id
  on conflict do nothing;
  insert into public.student_enrollment (school_id, student_id, academic_year_id, section_id, status) values (p_to, v_new, v_year, p_section, 'active');

  -- parents come along: the parent's existing record at the new campus (by login, phone or email), else a new one
  for g in select gu.*, gs.is_primary from public.guardian_student gs join public.guardian gu on gu.id = gs.guardian_id where gs.student_id = s.id loop
    select m2.guardian_id into v_g from public.person_membership m1 join public.person_membership m2 on m2.user_id = m1.user_id and m2.school_id = p_to and m2.role = 'guardian'
      where m1.guardian_id = g.id limit 1;
    if v_g is null then
      select x.id into v_g from public.guardian x where x.school_id = p_to
        and ((nullif(trim(g.phone), '') is not null and x.phone = g.phone) or (nullif(trim(g.email), '') is not null and lower(x.email) = lower(g.email))) limit 1;
    end if;
    if v_g is null then
      insert into public.guardian (school_id, full_name, relation, email, phone) values (p_to, g.full_name, g.relation, g.email, g.phone) returning id into v_g;
    end if;
    insert into public.guardian_student (school_id, guardian_id, student_id, is_primary) values (p_to, v_g, v_new, g.is_primary) on conflict do nothing;
    insert into public.person_membership (user_id, school_id, role, guardian_id)
    select m.user_id, p_to, 'guardian', v_g from public.person_membership m where m.guardian_id = g.id
    on conflict do nothing;
    v_g := null;
  end loop;
  insert into public.person_membership (user_id, school_id, role, student_id)
  select m.user_id, p_to, 'student', v_new from public.person_membership m where m.student_id = s.id
  on conflict (user_id, school_id, role) do update set student_id = excluded.student_id;
  update public.profile set school_id = p_to, student_id = v_new where student_id = s.id and role::text = 'student';

  with m as (
    select cr.*, tc.id to_course, ts.id to_sem from public.course_result cr
    join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
    left join public.course tc on tc.id = coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id and exists (select 1 from public.course cx where cx.id = (mm ->> 'to_course_id')::bigint and cx.school_id = p_to) limit 1), (select tc0.id from public.course tc0 where tc0.school_id = p_to and tc0.code = fc.code limit 1))
    left join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name
    left join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
    where cr.student_id = s.id),
  ins as (insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed, published_at, kind, counts, grace)
          select p_to, m.to_sem, v_new, m.to_course, m.attempt, m.credits, m.cia, m.cia_max, m.ese, m.ese_max, m.percent, m.grade, m.point, m.passed, m.published_at, m.kind, m.counts, m.grace
          from m where m.to_course is not null and m.to_sem is not null returning 1)
  select count(*) into v_carried from ins;
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_at, withheld_reason, published_as)
  select p_to, ts.id, v_new, sr.semester_no, sr.credits_registered, sr.credits_earned, sr.sgpa, sr.cgpa, sr.backlogs, sr.published_at, sr.withheld_reason, coalesce(sr.published_as, '') || ' (transferred)'
  from public.semester_result sr join public.semester fs on fs.id = sr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
  where sr.student_id = s.id
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_cgpa(array[v_new]);
  select cgpa into v_after from public.semester_result sr join public.semester sm on sm.id = sr.semester_id where sr.student_id = v_new order by sm.starts_on desc limit 1;

  update public.student_transport set is_active = false where student_id = s.id and is_active;
  update public.student set status = 'transferred', left_on = current_date, exit_remark = left('Transferred to ' || (select name from public.school where id = p_to), 200) where id = s.id;
  update public.student_enrollment set status = 'transferred' where student_id = s.id and status = 'active';
  insert into public.student_transfer (university_id, from_school, from_student, to_school, to_student, carried, not_carried, note, done_by, student_name, admission_no, cgpa_before, cgpa_after)
  values (v_uni, p_from, s.id, p_to, v_new, v_carried, v_missing, left(nullif(trim(coalesce(p_note, '')), ''), 300), auth.uid(), s.full_name, v_adm, v_before, v_after);
  return jsonb_build_object('student_id', v_new, 'admission_no', v_adm, 'carried', v_carried, 'not_carried', v_missing, 'cgpa_before', v_before, 'cgpa_after', v_after);
end $$;
revoke all on function public.transfer_student(bigint, text, bigint, bigint, text, boolean, jsonb) from public, anon;
grant execute on function public.transfer_student(bigint, text, bigint, bigint, text, boolean, jsonb) to authenticated;

drop function if exists public.copy_catalogue(bigint, bigint);
create function public.copy_catalogue(p_from bigint, p_to bigint, p_update boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d int; c int; p int; u int := 0;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can copy between two of its campuses'; end if;
  insert into public.department (school_id, code, name)
  select p_to, x.code, x.name from public.department x where x.school_id = p_from
    and not exists (select 1 from public.department y where y.school_id = p_to and (y.code = x.code or y.name = x.name));
  get diagnostics d = row_count;
  insert into public.course (school_id, department_id, code, name, kind, lecture, tutorial, practical, credits)
  select p_to, (select y.id from public.department y join public.department xd on xd.id = x.department_id where y.school_id = p_to and (y.code = xd.code or y.name = xd.name) limit 1),
         x.code, x.name, x.kind, x.lecture, x.tutorial, x.practical, x.credits
  from public.course x where x.school_id = p_from and not exists (select 1 from public.course y where y.school_id = p_to and y.code = x.code);
  get diagnostics c = row_count;
  insert into public.programme (school_id, department_id, code, name, level, regulation, years, semesters, total_credits, max_credits_per_semester)
  select p_to, (select y.id from public.department y join public.department xd on xd.id = x.department_id where y.school_id = p_to and (y.code = xd.code or y.name = xd.name) limit 1),
         x.code, x.name, x.level, x.regulation, x.years, x.semesters, x.total_credits, x.max_credits_per_semester
  from public.programme x where x.school_id = p_from and not exists (select 1 from public.programme y where y.school_id = p_to and y.code = x.code);
  get diagnostics p = row_count;
  if coalesce(p_update, false) then
    update public.course y set name = x.name, kind = x.kind, lecture = x.lecture, tutorial = x.tutorial, practical = x.practical, credits = x.credits
    from public.course x where x.school_id = p_from and y.school_id = p_to and y.code = x.code
      and (y.name, y.kind, y.lecture, y.tutorial, y.practical, y.credits) is distinct from (x.name, x.kind, x.lecture, x.tutorial, x.practical, x.credits);
    get diagnostics u = row_count;
  end if;
  return jsonb_build_object('departments', d, 'courses', c, 'programmes', p, 'updated', u);
end $$;
revoke all on function public.copy_catalogue(bigint, bigint, boolean) from public, anon;
grant execute on function public.copy_catalogue(bigint, bigint, boolean) to authenticated;

create or replace function public.copy_exam_session(p_session bigint, p_to bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare es public.exam_session; v_new bigint; v_year bigint; v_type bigint; n int; v_skip int;
begin
  select * into es from public.exam_session where id = p_session;
  if es.id is null or not app.is_central_for(es.school_id) or not app.is_central_for(p_to) or es.school_id = p_to then raise exception 'Only central administration can copy an exam between its campuses'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'That campus has no current year'; end if;
  select t2.id into v_type from public.assessment_type t1 join public.assessment_type t2 on t2.school_id = p_to and t2.code = t1.code where t1.id = es.assessment_type_id;
  if v_type is null then raise exception 'That campus has no matching kind of exam'; end if;
  insert into public.exam_session (school_id, academic_year_id, name, term, assessment_type_id, instructions, withhold_fee_dues, kind, fee_per_course, paper_max)
  values (p_to, v_year, es.name, es.term, v_type, es.instructions, es.withhold_fee_dues, es.kind, es.fee_per_course, es.paper_max) returning id into v_new;
  with m as (
    select p.*, (select c2.id from public.class c1 join public.class c2 on c2.school_id = p_to and lower(c2.name) = lower(c1.name) where c1.id = p.class_id) to_class,
      (select coalesce(
         (select s2.id from public.subject s1 join public.course k1 on k1.id = s1.course_id join public.course k2 on k2.school_id = p_to and k2.code = k1.code join public.subject s2 on s2.course_id = k2.id where s1.id = p.subject_id limit 1),
         (select s2.id from public.subject s1 join public.subject s2 on s2.school_id = p_to and lower(s2.name) = lower(s1.name) where s1.id = p.subject_id limit 1))) to_subject
    from public.exam_paper p where p.session_id = p_session),
  ins as (insert into public.exam_paper (school_id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
          select p_to, v_new, m.to_class, m.to_subject, m.exam_date, m.starts_at, m.ends_at, m.max_marks from m
          where m.to_subject is not null and (m.class_id is null or m.to_class is not null) returning 1)
  select (select count(*) from ins), (select count(*) from m) - (select count(*) from ins) into n, v_skip;
  return jsonb_build_object('session_id', v_new, 'papers', n, 'skipped', v_skip);
end $$;
revoke all on function public.copy_exam_session(bigint, bigint) from public, anon;
grant execute on function public.copy_exam_session(bigint, bigint) to authenticated;

create or replace function public.campus_exam_sessions(p_school bigint)
returns table (id bigint, name text, papers int)
language sql stable security definer set search_path = '' as $$
  select es.id, es.name, (select count(*)::int from public.exam_paper p where p.session_id = es.id)
  from public.exam_session es join public.academic_year y on y.id = es.academic_year_id and y.is_current
  where es.school_id = p_school and app.is_central_for(p_school) order by es.created_at desc;
$$;
revoke all on function public.campus_exam_sessions(bigint) from public, anon;
grant execute on function public.campus_exam_sessions(bigint) to authenticated;
-- the other campuses of this campus's university (for asking a transfer)
create or replace function public.sibling_campuses()
returns table (id bigint, name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name from public.school s
  where s.university_id = (select university_id from public.school where id = public.current_school_id()) and s.id <> public.current_school_id()
    and s.university_id is not null and coalesce(app.is_admin_scope(), false)
  order by s.name;
$$;
revoke all on function public.sibling_campuses() from public, anon;
grant execute on function public.sibling_campuses() to authenticated;

-- names of the students in transfer requests, for central administration (they may sit at another campus)
create or replace function public.transfer_request_students()
returns table (id bigint, full_name text, admission_no text)
language sql stable security definer set search_path = '' as $$
  select r.id, s.full_name, s.admission_no from public.transfer_request r join public.student s on s.id = r.student_id
  where r.university_id = public.current_university_id();
$$;
revoke all on function public.transfer_request_students() from public, anon;
grant execute on function public.transfer_request_students() to authenticated;
commit;
notify pgrst, 'reload schema';
