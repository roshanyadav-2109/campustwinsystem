-- Batch C: fixes from the product + CTO review.
begin;
create or replace function public.notify_family(p_school bigint, p_event text, p_dedupe text, p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = p_student and gs.school_id = p_school loop
    if public.notify_safe(p_school, p_event, p_dedupe || ':' || r.guardian_id, r.guardian_id, null, p_student, p_vars, p_title, p_body, p_link) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.notify_family(bigint, text, text, bigint, jsonb, text, text, text) from public, anon, authenticated;

-- staff who may look at one student's results: exam cell, office/head, department leads, class teacher
create or replace function public.staff_sees_student(p_student bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_exams() or coalesce(app.is_admin_scope(), false) or p_student in (select app.my_dept_students()) or p_student in (select app.my_ct_students());
$$;
grant execute on function public.staff_sees_student(bigint) to authenticated;

drop policy if exists srs_read on public.semester_result;
create policy srs_read on public.semester_result for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students()) or student_id in (select app.my_ct_students())
         or exists (select 1 from app.my_allot_pairs() p join public.student_enrollment e on e.section_id = p.section_id and e.student_id = semester_result.student_id and e.status = 'active')
         or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));
drop policy if exists crs_read on public.course_result;
create policy crs_read on public.course_result for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students()) or student_id in (select app.my_ct_students())
         or exists (select 1 from app.my_allot_pairs() p join public.subject sb on sb.id = p.subject_id and sb.course_id = course_result.course_id
                    join public.student_enrollment e on e.section_id = p.section_id and e.student_id = course_result.student_id and e.status = 'active')
         or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));

create or replace function public.publish_supplementary(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int; v_done bigint[];
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into s from public.exam_session where id = p_session and school_id = v_school and kind in ('supplementary', 'improvement');
  if s.id is null then raise exception 'Unknown supplementary or improvement exam'; end if;
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
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed, kind, counts)
    select v_school, j.semester_id, j.student_id, j.course_id, j.attempt, j.credits, j.cia, j.cia_max, j.ese, j.ese_w, j.pct,
      case when j.is_absent then 'Ab' when not j.ok then 'F'
           when s.kind = 'supplementary' and j.supp_max_point is not null and coalesce(j.gp, 0) > j.supp_max_point
             then coalesce((select eg.grade from public.eval_grade eg where eg.scheme_id = j.scheme_id and eg.point <= j.supp_max_point order by eg.point desc, eg.min_percent desc limit 1), 'P')
           else coalesce(j.g, 'P') end,
      case when not j.ok then 0 when s.kind = 'supplementary' then least(coalesce(j.gp, 0), coalesce(j.supp_max_point, coalesce(j.gp, 0))) else coalesce(j.gp, 0) end, j.ok,
      s.kind,
      case when s.kind = 'supplementary' then true
           else j.ok and coalesce(j.gp, 0) > coalesce((select max(b.point) from public.course_result b where b.student_id = j.student_id and b.course_id = j.course_id and b.counts and b.passed), 0) end
    from judged j
    on conflict (semester_id, student_id, course_id, attempt) do nothing
    returning id, student_id, course_id)
  , upd as (update public.supp_registration sr set status = 'published', result_id = ins.id
    from ins where sr.session_id = p_session and sr.student_id = ins.student_id and sr.course_id = ins.course_id returning sr.student_id)
  select count(*), coalesce(array_agg(distinct student_id), '{}') into n, v_done from upd;
  -- tell the families of the students just published
  perform public.notify_family(v_school, 'result_published', 'supp:' || p_session || ':' || x || ':' || extract(epoch from now())::bigint, x,
            jsonb_build_object('session', p_session), case when s.kind = 'improvement' then 'Improvement exam results' else 'Supplementary exam results' end,
            s.name || ': results are published', '/dashboard/results')
    from unnest(v_done) x;
  return n;
end $$;

create or replace function public.decide_revaluation(p_id bigint, p_new_ese numeric, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.reval_request; cr public.course_result; v_scheme bigint; g record;
begin
  if not app.can_publish_results() then raise exception 'Revaluation is decided by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into r from public.reval_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' then raise exception 'This request is not waiting'; end if;
  if r.invoice_id is not null and exists (select 1 from public.fee_invoice i where i.id = r.invoice_id and i.status in ('due', 'part')) then raise exception 'The fee is not paid yet'; end if;
  select * into cr from public.course_result where id = r.result_id for update;
  if p_new_ese is null or p_new_ese = cr.ese then
    update public.reval_request set status = 'no_change', new_ese = cr.ese, new_grade = cr.grade, note = left(p_note, 300), decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
    perform public.notify_family(cr.school_id, 'revaluation_decided', 'reval:' || r.id, cr.student_id, jsonb_build_object('request', r.id),
      initcap(r.kind) || ' result', (select code from public.course where id = cr.course_id) || ': no change', '/dashboard/results');
    return 'no_change';
  end if;
  if p_new_ese < 0 or p_new_ese > coalesce(cr.ese_max, 0) then raise exception 'Marks must be between 0 and %', cr.ese_max; end if;
  if cr.attempt > 1 then raise exception 'Revaluation is for the first attempt'; end if;
  select p.eval_scheme_id into v_scheme from public.student_enrollment e join public.semester s on s.id = cr.semester_id and s.academic_year_id = e.academic_year_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
   where e.student_id = cr.student_id order by (e.status = 'active') desc limit 1;
  if v_scheme is null then raise exception 'The programme has no evaluation scheme'; end if;
  select * into g from public.grade_course(v_scheme, cr.cia, cr.cia_max, p_new_ese, cr.ese_max, false);
  insert into public.course_result_revision (school_id, revised_by, reason, old) values (cr.school_id, app.my_staff_id(), left(initcap(r.kind) || ' #' || r.id, 200), to_jsonb(cr));
  update public.course_result set ese = p_new_ese, percent = g.percent, grade = g.grade, point = g.point, passed = g.passed, grace = null where id = cr.id;
  update public.reval_request set status = 'revised', new_ese = p_new_ese, new_grade = g.grade, note = left(p_note, 300), decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
  -- grace still applies to a revalued course, the semester line and CGPA follow
  perform public.apply_grace(cr.semester_id, array[cr.student_id]);
  perform public.refresh_semester_line(cr.student_id, cr.semester_id);
  perform public.refresh_cgpa(array[cr.student_id]);
  -- passed on revaluation: a pending supplementary registration for the course is no longer needed
  if not cr.passed and (select passed from public.course_result where id = cr.id) then
    perform public.withdraw_supp(x.id) from public.supp_registration x where x.student_id = cr.student_id and x.course_id = cr.course_id and x.status = 'registered';
  end if;
  update public.reval_request set new_grade = (select grade from public.course_result where id = cr.id) where id = r.id;
  perform public.notify_family(cr.school_id, 'revaluation_decided', 'reval:' || r.id, cr.student_id, jsonb_build_object('request', r.id),
    initcap(r.kind) || ' result', (select code from public.course where id = cr.course_id) || ': ' || coalesce(r.old_grade, '') || ' to ' || coalesce((select grade from public.course_result where id = cr.id), ''), '/dashboard/results');
  return 'revised';
end $$;

drop function if exists public.register_backlogs(bigint, bigint, bigint);
create or replace function public.register_backlogs(p_session bigint, p_student bigint default null, p_course bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int; v_self boolean; v_new bigint[];
begin
  select * into s from public.exam_session where id = p_session and school_id = v_school;
  if s.id is null or s.kind not in ('supplementary', 'improvement') or s.for_semester_id is null then raise exception 'Choose a supplementary or improvement exam for a semester'; end if;
  if s.kind = 'improvement' and (p_student is null or p_course is null) then raise exception 'Improvement is applied for one course at a time'; end if;
  v_self := not app.is_exams();
  if v_self then
    if p_student is null or p_course is null or not app.owns_student(p_student) then raise exception 'Only the exam cell can register others'; end if;
    if not s.self_registration or (s.registration_closes is not null and s.registration_closes < (now() at time zone 'Asia/Kolkata')::date) then raise exception 'Applications for this exam are closed'; end if;
  end if;
  with ins as (
    insert into public.supp_registration (school_id, session_id, student_id, course_id, semester_id, attempt, cia, cia_max, ese_max)
    select v_school, p_session, l.student_id, l.course_id, s.for_semester_id,
      (select max(a.attempt) from public.course_result a where a.student_id = l.student_id and a.course_id = l.course_id) + 1, l.cia, l.cia_max, s.paper_max
    from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.attempt, cr.cia, cr.cia_max, cr.passed
          from public.course_result cr where cr.semester_id = s.for_semester_id and cr.school_id = v_school
            and (p_student is null or cr.student_id = p_student) and (p_course is null or cr.course_id = p_course)
            and cr.counts
          order by cr.student_id, cr.course_id, cr.attempt desc) l
    where ((s.kind = 'supplementary' and not l.passed)
        or (s.kind = 'improvement' and l.passed and l.attempt = 1 and not exists (select 1 from public.course_result ix where ix.student_id = l.student_id and ix.course_id = l.course_id and ix.kind = 'improvement')))
      and not exists (select 1 from public.supp_registration x where x.student_id = l.student_id and x.course_id = l.course_id and x.status = 'registered')
    on conflict (session_id, student_id, course_id) do nothing
    returning id)
  select coalesce(array_agg(id), '{}'), count(*) into v_new, n from ins;
  -- the fee: one invoice per student for the new registrations (a second statement, so the new rows can be linked)
  if coalesce(s.fee_per_course, 0) > 0 and n > 0 then
    with per as (select student_id, count(*) c, min(id) first_id from public.supp_registration where id = any(v_new) group by student_id),
    inv as (
      insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
      select v_school, per.student_id, public.section_in_semester(per.student_id, (select id from public.semester where school_id = v_school and is_current)),
             s.academic_year_id,
             left(case when s.kind = 'improvement' then 'Improvement exam fee: ' else 'Supplementary exam fee: ' end || s.name || ' (' || per.c || ' course' || case when per.c > 1 then 's' else '' end || ') #' || s.id || '-' || per.first_id, 80),
             s.fee_per_course * per.c, coalesce(s.registration_closes, (now() at time zone 'Asia/Kolkata')::date + 14), 'due'
      from per
      returning id, student_id)
    update public.supp_registration sr set invoice_id = inv.id from inv where sr.student_id = inv.student_id and sr.id = any(v_new);
  end if;
  return n;
end $$;
revoke all on function public.register_backlogs(bigint, bigint, bigint) from public, anon;
grant execute on function public.register_backlogs(bigint, bigint, bigint) to authenticated;

create or replace function public.request_revaluation(p_result bigint, p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); cr public.course_result; sc public.school; v_fee numeric; v_inv bigint; v_id bigint; v_year bigint;
begin
  select * into cr from public.course_result where id = p_result and school_id = v_school;
  if cr.id is null then raise exception 'Unknown result'; end if;
  if p_kind not in ('revaluation', 'retotalling') then raise exception 'Choose revaluation or retotalling'; end if;
  if not (app.owns_student(cr.student_id) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if cr.grade = 'Ab' then raise exception 'There is no answer script to revalue (absent)'; end if;
  if cr.attempt > 1 then raise exception 'Revaluation is for the first attempt; ask the exam cell about re-takes'; end if;
  if exists (select 1 from public.reval_request x where x.result_id = cr.id and x.kind = p_kind and x.status <> 'withdrawn') then
    raise exception 'A % has already been asked for this course', p_kind;
  end if;
  if public.result_hold(cr.student_id, cr.semester_id) is not null and not app.is_exams() then raise exception 'This result is held back'; end if;
  select * into sc from public.school where id = v_school;
  if not app.is_exams() and (cr.published_at at time zone 'Asia/Kolkata')::date + sc.reval_window_days < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Requests closed % days after the results', sc.reval_window_days;
  end if;
  v_fee := case p_kind when 'revaluation' then sc.reval_fee else sc.retotal_fee end;
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  insert into public.reval_request (school_id, result_id, student_id, kind, old_ese, old_grade) values (v_school, cr.id, cr.student_id, p_kind, cr.ese, cr.grade)
  returning id into v_id;
  if coalesce(v_fee, 0) > 0 and v_year is not null then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, cr.student_id, public.section_in_semester(cr.student_id, (select id from public.semester where school_id = v_school and is_current)), v_year,
            left(initcap(p_kind) || ' fee: ' || (select code from public.course where id = cr.course_id) || ' #' || v_id, 80), v_fee, (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.reval_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting';
end $$;

create or replace function public.relax_apply(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  update public.relaxation_request set status = 'approved', step = array_length(chain, 1), decided_at = now(),
    until = case when kind = 'unlock' then (now() at time zone 'Asia/Kolkata')::date + 2 else until end
   where id = p_id returning * into r;
  if r.kind = 'attendance' and coalesce((select condonation_fee from public.school where id = r.school_id), 0) > 0
     and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = r.semester_id and cd.student_id = r.student_id and cd.subject_id = r.subject_id) then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    select r.school_id, r.student_id, public.section_in_semester(r.student_id, r.semester_id), s.academic_year_id,
           left('Condonation fee: ' || coalesce((select name from public.subject where id = r.subject_id), ''), 60) || ' #' || r.id,
           (select condonation_fee from public.school where id = r.school_id), (now() at time zone 'Asia/Kolkata')::date + 7, 'due'
    from public.semester s where s.id = r.semester_id;
  end if;
  if r.kind = 'attendance' then
    insert into public.attendance_condonation (school_id, semester_id, student_id, subject_id, reason, approved_by)
    values (r.school_id, r.semester_id, r.student_id, r.subject_id, left(r.reason, 200), app.my_staff_id())
    on conflict (semester_id, student_id, subject_id) do nothing;
  end if;
  perform public.relax_notify(p_id);
end $$;

create or replace function public.revoke_relaxation(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can withdraw'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  update public.relaxation_request set status = 'revoked', decided_at = now()
   where id = p_id and status = 'approved' and school_id = public.current_school_id() returning * into r;
  if r.id is null then raise exception 'Only an approved request can be withdrawn'; end if;
  insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
  values (r.school_id, r.id, 99, 'revoke', app.my_staff_id(), 'rejected', left(trim(p_reason), 300));
  -- an unpaid condonation fee goes with it
  update public.fee_invoice set status = 'cancelled' where student_id = r.student_id and title like '%#' || r.id and status = 'due' and coalesce(paid_amount, 0) = 0;
  if r.kind = 'attendance' then
    delete from public.attendance_condonation where semester_id = r.semester_id and student_id = r.student_id and subject_id = r.subject_id;
  end if;
end $$;

create or replace function public.student_standing(p_student bigint)
returns table (cgpa numeric, credits_earned numeric, backlogs int)
language sql stable security definer set search_path = '' as $$
  select round(sum(l.credits * l.point) filter (where l.passed or fc.fail_counts) / nullif(sum(l.credits) filter (where l.passed or fc.fail_counts), 0), 2),
         coalesce(sum(l.credits) filter (where l.passed), 0), (count(*) filter (where not l.passed))::int
  from (select distinct on (cr.course_id) cr.credits, cr.point, cr.passed from public.course_result cr join public.semester cs on cs.id = cr.semester_id
        where cr.student_id = p_student and cr.school_id = public.current_school_id() and cr.counts order by cr.course_id, cs.starts_on desc, cr.attempt desc) l
  cross join lateral (select coalesce((select es.fail_counts_in_gpa from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                        join public.programme p on p.id = c.programme_id join public.eval_scheme es on es.id = p.eval_scheme_id
                        where e.student_id = p_student order by (e.status = 'active') desc limit 1), true) fail_counts) fc
  where app.owns_student(p_student) or public.staff_sees_student(p_student)
  having count(*) > 0;
$$;

create or replace function public.student_backlogs(p_student bigint)
returns table (semester_id bigint, semester_no smallint, course_id bigint, course_code text, course_name text, credits numeric, attempts int, last_grade text)
language sql stable security definer set search_path = '' as $$
  select l.semester_id, sr.semester_no, l.course_id, c.code, c.name, l.credits, l.attempts, l.grade
  from (select distinct on (cr.course_id) cr.semester_id, cr.course_id, cr.credits, cr.grade, cr.passed,
               count(*) over (partition by cr.course_id)::int attempts
        from public.course_result cr where cr.student_id = p_student and cr.school_id = public.current_school_id() and cr.counts
        order by cr.course_id, cr.attempt desc) l
  join public.course c on c.id = l.course_id
  left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = p_student
  where not l.passed
    and (public.staff_sees_student(p_student) or app.owns_student(p_student))
  order by sr.semester_no nulls last, c.code;
$$;

create or replace function public.decide_relaxations(p_ids bigint[], p_note text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; n int := 0;
begin
  foreach v_id in array coalesce(p_ids, '{}') loop
    if public.relax_can_act(v_id) then perform public.decide_relaxation(v_id, true, coalesce(p_note, 'Approved with others')); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.decide_relaxations(bigint[], text) from public, anon;
grant execute on function public.decide_relaxations(bigint[], text) to authenticated;

create or replace function public.correct_supp_result(p_reg bigint, p_marks numeric, p_absent boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.supp_registration; s public.exam_session; cr public.course_result; es public.eval_scheme; v_w numeric; g record; v_point numeric; v_grade text; v_counts boolean;
begin
  if not app.can_publish_results() then raise exception 'Corrections are made by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason for the correction'; end if;
  select * into r from public.supp_registration where id = p_reg and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'published' or r.result_id is null then raise exception 'Only a published result can be corrected'; end if;
  if not p_absent and (p_marks is null or p_marks < 0 or p_marks > r.ese_max) then raise exception 'Marks must be between 0 and %', r.ese_max; end if;
  select * into s from public.exam_session where id = r.session_id;
  select * into cr from public.course_result where id = r.result_id for update;
  if exists (select 1 from public.course_result x where x.student_id = cr.student_id and x.course_id = cr.course_id and x.attempt > cr.attempt) then
    raise exception 'A later attempt exists for this course; correct that one instead';
  end if;
  select x.* into es from public.student_enrollment e join public.semester sem on sem.id = r.semester_id and sem.academic_year_id = e.academic_year_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
    join public.eval_scheme x on x.id = p.eval_scheme_id where e.student_id = r.student_id order by (e.status = 'active') desc limit 1;
  if es.id is null then raise exception 'The programme has no evaluation scheme'; end if;
  select sum(weight) into v_w from public.eval_component where scheme_id = es.id and part = 'ese';
  if coalesce(v_w, 0) = 0 then raise exception 'The scheme has no end-semester part'; end if;
  select * into g from public.grade_course(es.id, r.cia, r.cia_max, case when p_absent then 0 else round(p_marks / r.ese_max * v_w, 2) end, v_w, p_absent);
  v_point := g.point; v_grade := g.grade;
  if s.kind = 'supplementary' and g.passed and es.supp_max_point is not null and g.point > es.supp_max_point then
    v_point := es.supp_max_point;
    v_grade := coalesce((select eg.grade from public.eval_grade eg where eg.scheme_id = es.id and eg.point <= es.supp_max_point order by eg.point desc, eg.min_percent desc limit 1), 'P');
  end if;
  v_counts := case when s.kind = 'supplementary' then true
                   else g.passed and v_point > coalesce((select max(b.point) from public.course_result b where b.student_id = r.student_id and b.course_id = r.course_id and b.counts and b.passed and b.id <> cr.id), 0) end;
  insert into public.course_result_revision (school_id, revised_by, reason, old) values (cr.school_id, app.my_staff_id(), left('Correction: ' || p_reason, 200), to_jsonb(cr));
  update public.course_result set ese = case when p_absent then 0 else round(p_marks / r.ese_max * v_w, 2) end, percent = g.percent, grade = v_grade, point = v_point, passed = g.passed, counts = v_counts where id = cr.id;
  update public.supp_registration set ese_marks = case when p_absent then null else p_marks end, is_absent = p_absent where id = r.id;
end $$;

create or replace function public.reject_registrations(p_semester bigint, p_ids bigint[], p_reason text) returns int
language sql security definer set search_path = '' as $$
  with u as (update public.course_registration r set status = 'dropped', drop_reason = left(nullif(trim(p_reason), ''), 200)
             where r.semester_id = p_semester and r.id = any(p_ids) and r.status = 'registered' and r.school_id = public.current_school_id()
               and exists (select 1 from public.programme_course pc where pc.id = r.programme_course_id and pc.elective_group is not null)
               and (coalesce(app.is_office(), false) or coalesce(public.section_in_semester(r.student_id, r.semester_id) in (select app.my_scope_sections()), false))
             returning 1)
  select count(*)::int from u;
$$;
commit;
notify pgrst, 'reload schema';
