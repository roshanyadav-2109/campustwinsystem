-- Batch C: fixes left over from the reviews (colleges and universities).
begin;
-- 1. results: only the people concerned (exam cell, office and head, the student's department leads and teachers, the family)
drop policy if exists srs_read on public.semester_result;
create policy srs_read on public.semester_result for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students()) or student_id in (select app.my_scope_students())
         or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));
drop policy if exists crs_read on public.course_result;
create policy crs_read on public.course_result for select to authenticated
  using ((select app.is_exams()) or (select app.is_admin_scope()) or student_id in (select app.my_dept_students()) or student_id in (select app.my_scope_students())
         or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));

-- 2. hall tickets follow the exam's own semester
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
  -- the exam's own semester (term 1 = odd, 2 = even of the exam's year); the current one if there is none
  select * into v_sem from public.semester where school_id = v_school and academic_year_id = v_s.academic_year_id
     and kind = case v_s.term when 1 then 'odd' when 2 then 'even' else kind end order by is_current desc, starts_on desc limit 1;
  if v_sem.id is null then select * into v_sem from public.semester where school_id = v_school and is_current; end if;
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

-- 3. the attendance cut-off must fall within the semester
create or replace function public.set_attendance_rules(p_mode text, p_days int, p_minimum numeric, p_floor numeric, p_hold_fees boolean, p_chain jsonb, p_cutoff date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not (coalesce(app.is_admin_scope(), false) or app.has_access('exams_head')) then raise exception 'Only the office, the principal or the examinations head can change these rules'; end if;
  if p_floor is not null and p_floor > p_minimum then raise exception 'The floor must be below the minimum attendance'; end if;
  update public.school set attendance_lock_mode = p_mode, attendance_edit_days = p_days, attendance_minimum = p_minimum, condone_floor = p_floor,
    hold_results_fees = p_hold_fees, relax_chain = p_chain where id = v_school;
  if p_cutoff is not null and not exists (select 1 from public.semester where school_id = v_school and is_current and p_cutoff between starts_on and ends_on) then
    raise exception 'The attendance cut-off must fall within the current semester';
  end if;
  update public.semester set attendance_cutoff = p_cutoff where school_id = v_school and is_current;
end $$;

-- 4. supplementary results tell the students
create or replace function public.publish_supplementary(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int;
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
  update public.supp_registration sr set status = 'published', result_id = ins.id
  from ins where sr.session_id = p_session and sr.student_id = ins.student_id and sr.course_id = ins.course_id;
  get diagnostics n = row_count;
  -- tell the students (and their families)
  perform public.notify_safe(v_school, 'result_published', 'supp:' || p_session || ':' || x.student_id, null, null, x.student_id,
            jsonb_build_object('session', p_session), case when s.kind = 'improvement' then 'Improvement exam results' else 'Supplementary exam results' end,
            s.name || ': results are published', '/dashboard/results')
    from (select distinct sr.student_id from public.supp_registration sr where sr.session_id = p_session and sr.status = 'published'
          and sr.result_id in (select cr.id from public.course_result cr where cr.published_at > now() - interval '5 minutes')) x;
  return n;
end $$;

-- 5. correcting a published supplementary or improvement result (with a reason, old kept)
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
  select x.* into es from public.student_enrollment e join public.semester sem on sem.id = r.semester_id and sem.academic_year_id = e.academic_year_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
    join public.eval_scheme x on x.id = p.eval_scheme_id where e.student_id = r.student_id order by (e.status = 'active') desc limit 1;
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
revoke all on function public.correct_supp_result(bigint, numeric, boolean, text) from public, anon;
grant execute on function public.correct_supp_result(bigint, numeric, boolean, text) to authenticated;

-- 6. per-student decisions on course choices: reject (drop) with a reason
alter table public.course_registration add column if not exists drop_reason text check (drop_reason is null or char_length(drop_reason) <= 200);
create or replace function public.reject_registrations(p_semester bigint, p_ids bigint[], p_reason text) returns int
language sql security definer set search_path = '' as $$
  with u as (update public.course_registration r set status = 'dropped', drop_reason = left(nullif(trim(p_reason), ''), 200)
             where r.semester_id = p_semester and r.id = any(p_ids) and r.status = 'registered' and r.school_id = public.current_school_id()
               and (coalesce(app.is_office(), false) or coalesce(public.section_in_semester(r.student_id, r.semester_id) in (select app.my_scope_sections()), false))
             returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.reject_registrations(bigint, bigint[], text) from public, anon;
grant execute on function public.reject_registrations(bigint, bigint[], text) to authenticated;

-- 7. condonation fee on approved attendance relaxations
alter table public.school add column if not exists condonation_fee numeric(10,2) check (condonation_fee is null or condonation_fee >= 0);
create or replace function public.relax_apply(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  update public.relaxation_request set status = 'approved', step = array_length(chain, 1), decided_at = now(),
    until = case when kind = 'unlock' then (now() at time zone 'Asia/Kolkata')::date + 2 else until end
   where id = p_id returning * into r;
  if r.kind = 'attendance' and coalesce((select condonation_fee from public.school where id = r.school_id), 0) > 0 then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    select r.school_id, r.student_id, public.section_in_semester(r.student_id, r.semester_id), s.academic_year_id,
           left('Attendance condonation fee: ' || coalesce((select name from public.subject where id = r.subject_id), '') || ' #' || r.id, 160),
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
commit;
notify pgrst, 'reload schema';
