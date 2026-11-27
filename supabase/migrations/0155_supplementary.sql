-- Higher education, step 9: backlogs and supplementary exams.
--   A backlog is a course whose latest attempt is not passed.
--   The exam cell creates a supplementary session for a semester (optional fee
--   per course), registers every backlog in one step (one fee invoice per
--   student), enters the end-semester marks, and publishes. Internal (CIA)
--   marks carry forward from the last attempt; each re-take is a new attempt
--   graded by the programme's scheme, with an optional cap on the grade point a
--   supplementary pass can earn. The original grade card stays as published;
--   CGPA counts the latest attempt. Hall tickets list only re-taken courses.
begin;
alter table public.exam_session add column if not exists kind text not null default 'regular' check (kind in ('regular', 'supplementary', 'improvement'));
alter table public.exam_session add column if not exists for_semester_id bigint references public.semester(id) on delete set null;
alter table public.exam_session add column if not exists fee_per_course numeric(10,2) check (fee_per_course is null or fee_per_course >= 0);
alter table public.exam_session add column if not exists registration_closes date;
alter table public.eval_scheme add column if not exists supp_max_point numeric(4,2) check (supp_max_point is null or supp_max_point >= 0);

create table if not exists public.supp_registration (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id  bigint not null references public.exam_session(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  course_id   bigint not null references public.course(id) on delete cascade,
  semester_id bigint not null references public.semester(id) on delete cascade,
  attempt     smallint not null check (attempt >= 2),
  cia         numeric(6,2),
  cia_max     numeric(6,2),
  ese_marks   numeric(6,2) check (ese_marks is null or ese_marks >= 0),
  ese_max     numeric(6,2) not null default 100 check (ese_max > 0),
  is_absent   boolean not null default false,
  invoice_id  bigint references public.fee_invoice(id) on delete set null,
  status      text not null default 'registered' check (status in ('registered', 'published')),
  result_id   bigint references public.course_result(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (session_id, student_id, course_id),
  check (ese_marks is null or ese_marks <= ese_max)
);
create index if not exists idx_supp_student on public.supp_registration (student_id);
alter table public.supp_registration enable row level security;
drop policy if exists tenant_isolation on public.supp_registration;
create policy tenant_isolation on public.supp_registration as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists supp_read on public.supp_registration;
create policy supp_read on public.supp_registration for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students()) or app.owns_student(student_id));
revoke all on public.supp_registration from anon, authenticated;
grant select on public.supp_registration to authenticated;
grant all on public.supp_registration to service_role;

-- a student's open backlogs (latest attempt of each course not passed)
create or replace function public.student_backlogs(p_student bigint)
returns table (semester_id bigint, semester_no smallint, course_id bigint, course_code text, course_name text, credits numeric, attempts int, last_grade text)
language sql stable security definer set search_path = '' as $$
  select l.semester_id, sr.semester_no, l.course_id, c.code, c.name, l.credits, l.attempts, l.grade
  from (select distinct on (cr.course_id) cr.semester_id, cr.course_id, cr.credits, cr.grade, cr.passed,
               count(*) over (partition by cr.course_id)::int attempts
        from public.course_result cr where cr.student_id = p_student and cr.school_id = public.current_school_id()
        order by cr.course_id, cr.attempt desc) l
  join public.course c on c.id = l.course_id
  left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = p_student
  where not l.passed
    and (app.my_staff_id() is not null or app.owns_student(p_student))
  order by sr.semester_no nulls last, c.code;
$$;
grant execute on function public.student_backlogs(bigint) to authenticated;

-- backlogs of a semester (exam cell)
create or replace function public.semester_backlogs(p_semester bigint)
returns table (student_id bigint, student_name text, admission_no text, course_id bigint, course_code text, course_name text, attempts int)
language sql stable security definer set search_path = '' as $$
  select l.student_id, st.full_name, st.admission_no, l.course_id, c.code, c.name, l.attempts
  from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.passed,
               count(*) over (partition by cr.student_id, cr.course_id)::int attempts
        from public.course_result cr where cr.semester_id = p_semester and cr.school_id = public.current_school_id()
        order by cr.student_id, cr.course_id, cr.attempt desc) l
  join public.student st on st.id = l.student_id join public.course c on c.id = l.course_id
  where not l.passed and (app.is_exams() or coalesce(app.is_admin_scope(), false))
  order by st.full_name, c.code;
$$;
grant execute on function public.semester_backlogs(bigint) to authenticated;

-- register every open backlog of the session's semester (or one student's); one fee invoice per student
create or replace function public.register_backlogs(p_session bigint, p_student bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int; r record; v_inv bigint; v_count int;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can register supplementary candidates'; end if;
  select * into s from public.exam_session where id = p_session and school_id = v_school;
  if s.id is null or s.kind <> 'supplementary' or s.for_semester_id is null then raise exception 'Choose a supplementary exam for a semester'; end if;
  insert into public.supp_registration (school_id, session_id, student_id, course_id, semester_id, attempt, cia, cia_max)
  select v_school, p_session, l.student_id, l.course_id, s.for_semester_id, l.attempt + 1, l.cia, l.cia_max
  from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.attempt, cr.cia, cr.cia_max, cr.passed
        from public.course_result cr where cr.semester_id = s.for_semester_id and cr.school_id = v_school and (p_student is null or cr.student_id = p_student)
        order by cr.student_id, cr.course_id, cr.attempt desc) l
  where not l.passed
    and not exists (select 1 from public.supp_registration x join public.exam_session xs on xs.id = x.session_id
                    where x.student_id = l.student_id and x.course_id = l.course_id and x.status = 'registered')
  on conflict (session_id, student_id, course_id) do nothing;
  get diagnostics n = row_count;
  -- the exam fee: one invoice per student for their new registrations
  if coalesce(s.fee_per_course, 0) > 0 then
    for r in select sr.student_id, array_agg(sr.id) ids, count(*) c from public.supp_registration sr
             where sr.session_id = p_session and sr.invoice_id is null and (p_student is null or sr.student_id = p_student) group by sr.student_id loop
      insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
      values (v_school, r.student_id, public.section_in_semester(r.student_id, (select id from public.semester where school_id = v_school and is_current)),
              s.academic_year_id, left('Supplementary exam fee: ' || s.name || ' (' || r.c || ' course' || case when r.c > 1 then 's' else '' end || ')', 120),
              s.fee_per_course * r.c, coalesce(s.registration_closes, (now() at time zone 'Asia/Kolkata')::date + 14), 'due')
      returning id into v_inv;
      update public.supp_registration set invoice_id = v_inv where id = any(r.ids);
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.register_backlogs(bigint, bigint) from public, anon;
grant execute on function public.register_backlogs(bigint, bigint) to authenticated;

-- end-semester marks of the supplementary exam (exam cell)
create or replace function public.save_supp_marks(p_ids bigint[], p_marks numeric[], p_absent boolean[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can enter supplementary marks'; end if;
  if cardinality(p_ids) <> cardinality(p_marks) or cardinality(p_ids) <> cardinality(p_absent) then raise exception 'Marks do not line up'; end if;
  update public.supp_registration sr set ese_marks = case when x.absent then null else x.marks end, is_absent = x.absent
  from unnest(p_ids, p_marks, p_absent) as x(id, marks, absent)
  where sr.id = x.id and sr.school_id = public.current_school_id() and sr.status = 'registered'
    and (x.absent or x.marks is null or (x.marks >= 0 and x.marks <= sr.ese_max));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.save_supp_marks(bigint[], numeric[], boolean[]) from public, anon;
grant execute on function public.save_supp_marks(bigint[], numeric[], boolean[]) to authenticated;

-- publish the supplementary results: a new attempt per course, graded by the scheme
create or replace function public.publish_supplementary(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; v_ids bigint[]; n int;
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into s from public.exam_session where id = p_session and school_id = v_school and kind = 'supplementary';
  if s.id is null then raise exception 'Unknown supplementary exam'; end if;
  with ready as (
    select sr.*, c.credits, es.id scheme_id, es.pass_percent, es.ese_min_percent, es.supp_max_point,
      (select sum(ec.weight) from public.eval_component ec where ec.scheme_id = es.id and ec.part = 'ese') ese_w
    from public.supp_registration sr join public.course c on c.id = sr.course_id
    join public.semester sem on sem.id = sr.semester_id
    left join lateral (select x.* from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class cl on cl.id = sec.class_id
                       join public.programme p on p.id = cl.programme_id join public.eval_scheme x on x.id = p.eval_scheme_id
                       where e.student_id = sr.student_id and e.academic_year_id = sem.academic_year_id order by (e.status = 'active') desc limit 1) es on true
    where sr.session_id = p_session and sr.status = 'registered' and (sr.ese_marks is not null or sr.is_absent) and es.id is not null),
  scored as (
    select r.*, round(case when r.is_absent then 0 else r.ese_marks / r.ese_max * r.ese_w end, 2) ese,
      round((coalesce(r.cia, 0) + case when r.is_absent then 0 else r.ese_marks / r.ese_max * r.ese_w end) / nullif(coalesce(r.cia_max, 0) + r.ese_w, 0) * 100, 2) pct
    from ready r),
  judged as (
    select sc.*, (not sc.is_absent and sc.pct >= sc.pass_percent and (sc.ese_min_percent is null or sc.ese / nullif(sc.ese_w, 0) * 100 >= sc.ese_min_percent)) ok,
      (select eg.grade from public.eval_grade eg where eg.scheme_id = sc.scheme_id and eg.min_percent <= sc.pct order by eg.min_percent desc limit 1) g,
      (select eg.point from public.eval_grade eg where eg.scheme_id = sc.scheme_id and eg.min_percent <= sc.pct order by eg.min_percent desc limit 1) gp
    from scored sc),
  ins as (
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, j.semester_id, j.student_id, j.course_id, j.attempt, j.credits, j.cia, j.cia_max, j.ese, j.ese_w, j.pct,
      case when j.is_absent then 'Ab' when j.ok then coalesce(j.g, 'P') else 'F' end,
      case when j.ok then least(coalesce(j.gp, 0), coalesce(j.supp_max_point, coalesce(j.gp, 0))) else 0 end, j.ok
    from judged j
    on conflict (semester_id, student_id, course_id, attempt) do nothing
    returning id, student_id, course_id)
  update public.supp_registration sr set status = 'published', result_id = ins.id
  from ins where sr.session_id = p_session and sr.student_id = ins.student_id and sr.course_id = ins.course_id;
  get diagnostics n = row_count;
  select coalesce(array_agg(distinct student_id), '{}') into v_ids from public.supp_registration where session_id = p_session and status = 'published';
  -- CGPA counts the latest attempt
  update public.semester_result sr set cgpa = x.cgpa
  from (
    select me.id, round(sum(l.credits * l.point) filter (where l.passed or fc.fail_counts) / nullif(sum(l.credits) filter (where l.passed or fc.fail_counts), 0), 2) cgpa
    from public.semester_result me join public.semester ms on ms.id = me.semester_id
    cross join lateral (
      select coalesce((select es.fail_counts_in_gpa from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                        join public.programme p on p.id = c.programme_id join public.eval_scheme es on es.id = p.eval_scheme_id
                        where e.student_id = me.student_id order by (e.status = 'active') desc limit 1), true) fail_counts) fc
    cross join lateral (
      select distinct on (cr.course_id) cr.credits, cr.point, cr.passed
      from public.course_result cr join public.semester cs on cs.id = cr.semester_id
      where cr.student_id = me.student_id and cs.starts_on <= ms.starts_on
      order by cr.course_id, cs.starts_on desc, cr.attempt desc) l
    where me.student_id = any(v_ids)
    group by me.id) x
  where sr.id = x.id;
  return n;
end $$;
revoke all on function public.publish_supplementary(bigint) from public, anon;
grant execute on function public.publish_supplementary(bigint) to authenticated;

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
     and (v_s.kind <> 'supplementary' or exists (select 1 from public.supp_registration sr where sr.session_id = p_session and sr.student_id = e.student_id))
  on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, e.roll_no::int roll, c.name || '-' || sec.name cls, st.photo_path, ac.verify_token tok,
      case when v_s.withhold_fee_dues and not public.fee_relaxed(st.id, coalesce(v_first, current_date)) then public.overdue_fees(st.id, coalesce(v_first, current_date)) else 0 end bal,
      case when v_s.kind = 'supplementary' then (
        select array_agg(distinct sb.id) from public.supp_registration sr join public.subject sb on sb.course_id = sr.course_id and sb.school_id = v_school
        where sr.session_id = p_session and sr.student_id = st.id)
           when v_he and v_sem.id is not null then (
        select array_agg(distinct sb.id) from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
        join public.subject sb on sb.course_id = pc.course_id and sb.school_id = v_school
        where r.semester_id = v_sem.id and r.student_id = st.id and r.status <> 'dropped') end subj,
      case when v_he and v_sem.id is not null and v_s.kind <> 'supplementary' then public.attendance_shortage(st.id, v_sem.id) end short
    from public.student_enrollment e
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
    where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
      and (v_s.kind <> 'supplementary' or exists (select 1 from public.supp_registration sr where sr.session_id = p_session and sr.student_id = st.id)))
  select b.sid, b.full_name, b.admission_no, b.roll, b.cls, b.photo_path,
    b.bal > 0 or b.short is not null,
    case when b.short is not null then 'Attendance below ' || v_min || '% in ' || b.short
         when b.bal > 0 then (case when app.is_office() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when b.bal > 0 or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
