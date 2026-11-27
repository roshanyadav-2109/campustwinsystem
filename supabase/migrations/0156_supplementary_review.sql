-- Supplementary exams: fixes from the product + CTO review.
begin;
alter table public.exam_session add column if not exists paper_max numeric(6,2) not null default 100 check (paper_max > 0);
alter table public.exam_session add column if not exists self_registration boolean not null default true;

-- students see their supplementary marks only once published
drop policy if exists supp_read on public.supp_registration;
create policy supp_read on public.supp_registration for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students())
         or (app.owns_student(student_id) and status = 'published'));
-- a student's own registrations (to show what they applied for, without marks)
create or replace function public.my_supp_registrations(p_student bigint)
returns table (id bigint, session_id bigint, session_name text, course_id bigint, course_code text, status text, fee_due numeric)
language sql stable security definer set search_path = '' as $$
  select sr.id, sr.session_id, s.name, sr.course_id, c.code, sr.status,
    (select coalesce(i.amount - coalesce(i.paid_amount, 0), 0) from public.fee_invoice i where i.id = sr.invoice_id and i.status in ('due', 'part'))
  from public.supp_registration sr join public.exam_session s on s.id = sr.session_id join public.course c on c.id = sr.course_id
  where sr.student_id = p_student and sr.school_id = public.current_school_id() and (app.owns_student(p_student) or app.my_staff_id() is not null)
  order by s.created_at desc, c.code;
$$;
grant execute on function public.my_supp_registrations(bigint) to authenticated;
-- supplementary sessions open for applications now
create or replace function public.open_supplementary(p_student bigint)
returns table (session_id bigint, session_name text, for_semester_id bigint, fee_per_course numeric, registration_closes date)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.for_semester_id, s.fee_per_course, s.registration_closes from public.exam_session s
  where s.school_id = public.current_school_id() and s.kind = 'supplementary' and s.self_registration
    and (s.registration_closes is null or s.registration_closes >= (now() at time zone 'Asia/Kolkata')::date)
    and (app.owns_student(p_student) or app.my_staff_id() is not null)
  order by s.created_at desc;
$$;
grant execute on function public.open_supplementary(bigint) to authenticated;

-- registering: set-based, one invoice per student (titled with the exam), paper maximum from the exam.
-- Who: the exam cell for anyone; a student or parent for their own backlog while applications are open.
drop function if exists public.register_backlogs(bigint, bigint);
drop function if exists public.register_backlogs(bigint, bigint, bigint);
create function public.register_backlogs(p_session bigint, p_student bigint default null, p_course bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int; v_self boolean;
begin
  select * into s from public.exam_session where id = p_session and school_id = v_school;
  if s.id is null or s.kind <> 'supplementary' or s.for_semester_id is null then raise exception 'Choose a supplementary exam for a semester'; end if;
  v_self := not app.is_exams();
  if v_self then
    if p_student is null or p_course is null or not app.owns_student(p_student) then raise exception 'Only the exam cell can register others'; end if;
    if not s.self_registration or (s.registration_closes is not null and s.registration_closes < (now() at time zone 'Asia/Kolkata')::date) then raise exception 'Applications for this exam are closed'; end if;
  end if;
  with ins as (
    insert into public.supp_registration (school_id, session_id, student_id, course_id, semester_id, attempt, cia, cia_max, ese_max)
    select v_school, p_session, l.student_id, l.course_id, s.for_semester_id, l.attempt + 1, l.cia, l.cia_max, s.paper_max
    from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.attempt, cr.cia, cr.cia_max, cr.passed
          from public.course_result cr where cr.semester_id = s.for_semester_id and cr.school_id = v_school
            and (p_student is null or cr.student_id = p_student) and (p_course is null or cr.course_id = p_course)
          order by cr.student_id, cr.course_id, cr.attempt desc) l
    where not l.passed
      and not exists (select 1 from public.supp_registration x where x.student_id = l.student_id and x.course_id = l.course_id and x.status = 'registered')
    on conflict (session_id, student_id, course_id) do nothing
    returning id, student_id),
  per as (select student_id, array_agg(id) ids, count(*) c from ins group by student_id),
  inv as (
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    select v_school, per.student_id, public.section_in_semester(per.student_id, (select id from public.semester where school_id = v_school and is_current)),
           s.academic_year_id,
           left('Supplementary exam fee: ' || s.name || ' (' || per.c || ' course' || case when per.c > 1 then 's' else '' end || ') #' || s.id || '-' || per.student_id || '-' || extract(epoch from clock_timestamp())::bigint, 160),
           s.fee_per_course * per.c, coalesce(s.registration_closes, (now() at time zone 'Asia/Kolkata')::date + 14), 'due'
    from per where coalesce(s.fee_per_course, 0) > 0
    returning id, student_id)
  , upd as (update public.supp_registration sr set invoice_id = inv.id
    from inv, per where per.student_id = inv.student_id and sr.id = any(per.ids) returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.register_backlogs(bigint, bigint, bigint) from public, anon;
grant execute on function public.register_backlogs(bigint, bigint, bigint) to authenticated;

-- withdraw a registration before results (exam cell, or the student for their own); the fee drops with it
create or replace function public.withdraw_supp(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.supp_registration; v_fee numeric;
begin
  select * into r from public.supp_registration where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'registered' then raise exception 'Only a registration waiting for its exam can be withdrawn'; end if;
  if not (app.is_exams() or app.owns_student(r.student_id)) then raise exception 'Not allowed'; end if;
  select fee_per_course into v_fee from public.exam_session where id = r.session_id;
  delete from public.supp_registration where id = r.id;
  if r.invoice_id is not null and coalesce(v_fee, 0) > 0 then
    update public.fee_invoice set amount = greatest(amount - v_fee, coalesce(paid_amount, 0)) where id = r.invoice_id and status in ('due', 'part');
    update public.fee_invoice set status = 'cancelled' where id = r.invoice_id and amount <= 0 and coalesce(paid_amount, 0) = 0 and status = 'due';
  end if;
end $$;
revoke all on function public.withdraw_supp(bigint) from public, anon;
grant execute on function public.withdraw_supp(bigint) to authenticated;

-- close an exam: anyone without marks is absent, then everything is published (nobody stays stuck)
create or replace function public.close_supplementary(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  update public.supp_registration set is_absent = true where session_id = p_session and status = 'registered' and ese_marks is null and school_id = public.current_school_id();
  return public.publish_supplementary(p_session);
end $$;
revoke all on function public.close_supplementary(bigint) from public, anon;
grant execute on function public.close_supplementary(bigint) to authenticated;

create or replace function public.publish_supplementary(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int;
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
  ready2 as (select * from ready where coalesce(ese_w, 0) > 0),
  scored as (
    select r.*, round(case when r.is_absent then 0 else r.ese_marks / r.ese_max * r.ese_w end, 2) ese,
      round((coalesce(r.cia, 0) + case when r.is_absent then 0 else r.ese_marks / r.ese_max * r.ese_w end) / nullif(coalesce(r.cia_max, 0) + r.ese_w, 0) * 100, 2) pct
    from ready2 r),
  judged as (
    select sc.*, (not sc.is_absent and sc.pct >= sc.pass_percent and (sc.ese_min_percent is null or sc.ese / nullif(sc.ese_w, 0) * 100 >= sc.ese_min_percent)) ok,
      (select eg.grade from public.eval_grade eg where eg.scheme_id = sc.scheme_id and eg.min_percent <= sc.pct order by eg.min_percent desc limit 1) g,
      (select eg.point from public.eval_grade eg where eg.scheme_id = sc.scheme_id and eg.min_percent <= sc.pct order by eg.min_percent desc limit 1) gp
    from scored sc),
  ins as (
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, j.semester_id, j.student_id, j.course_id, j.attempt, j.credits, j.cia, j.cia_max, j.ese, j.ese_w, j.pct,
      case when j.is_absent then 'Ab' when not j.ok then 'F'
           when j.supp_max_point is not null and coalesce(j.gp, 0) > j.supp_max_point
             then coalesce((select eg.grade from public.eval_grade eg where eg.scheme_id = j.scheme_id and eg.point <= j.supp_max_point order by eg.point desc, eg.min_percent desc limit 1), 'P')
           else coalesce(j.g, 'P') end,
      case when j.ok then least(coalesce(j.gp, 0), coalesce(j.supp_max_point, coalesce(j.gp, 0))) else 0 end, j.ok
    from judged j
    on conflict (semester_id, student_id, course_id, attempt) do nothing
    returning id, student_id, course_id)
  update public.supp_registration sr set status = 'published', result_id = ins.id
  from ins where sr.session_id = p_session and sr.student_id = ins.student_id and sr.course_id = ins.course_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- where a student stands now (latest attempt of every course); the published grade cards stay as they were
create or replace function public.student_standing(p_student bigint)
returns table (cgpa numeric, credits_earned numeric, backlogs int)
language sql stable security definer set search_path = '' as $$
  select round(sum(l.credits * l.point) filter (where l.passed or fc.fail_counts) / nullif(sum(l.credits) filter (where l.passed or fc.fail_counts), 0), 2),
         coalesce(sum(l.credits) filter (where l.passed), 0), (count(*) filter (where not l.passed))::int
  from (select distinct on (cr.course_id) cr.credits, cr.point, cr.passed from public.course_result cr join public.semester cs on cs.id = cr.semester_id
        where cr.student_id = p_student and cr.school_id = public.current_school_id() order by cr.course_id, cs.starts_on desc, cr.attempt desc) l
  cross join lateral (select coalesce((select es.fail_counts_in_gpa from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                        join public.programme p on p.id = c.programme_id join public.eval_scheme es on es.id = p.eval_scheme_id
                        where e.student_id = p_student order by (e.status = 'active') desc limit 1), true) fail_counts) fc
  where app.owns_student(p_student) or app.my_staff_id() is not null
  having count(*) > 0;
$$;
grant execute on function public.student_standing(bigint) to authenticated;

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
      case when v_s.kind = 'supplementary' then (
             -- the supplementary fee must be paid (or extended) before the hall ticket, whatever its due date
             select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) from public.fee_invoice i
             where i.id in (select sr.invoice_id from public.supp_registration sr where sr.session_id = p_session and sr.student_id = st.id)
               and i.status in ('due', 'part') and not public.fee_relaxed(st.id, current_date))
           when v_s.withhold_fee_dues and not public.fee_relaxed(st.id, coalesce(v_first, current_date)) then public.overdue_fees(st.id, coalesce(v_first, current_date)) else 0 end bal,
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
