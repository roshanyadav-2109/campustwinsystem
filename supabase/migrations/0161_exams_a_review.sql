-- Exams batch A: fixes from the product + CTO review.
begin;
-- a revision no longer deletes revaluation requests; they are moved to the new rows
alter table public.reval_request drop constraint if exists reval_request_result_id_fkey;
alter table public.reval_request alter column result_id drop not null;
alter table public.reval_request add constraint reval_request_result_id_fkey foreign key (result_id) references public.course_result(id) on delete set null;
alter table public.reval_request add column if not exists course_id bigint references public.course(id) on delete cascade;
alter table public.reval_request add column if not exists semester_id bigint references public.semester(id) on delete cascade;
update public.reval_request r set course_id = cr.course_id, semester_id = cr.semester_id from public.course_result cr where cr.id = r.result_id and r.course_id is null;
-- one open request per course result, whatever the kind
drop index if exists public.uq_reval_open;
create unique index if not exists uq_reval_open_any on public.reval_request (result_id) where status = 'requested';
create or replace function public.reval_fill() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.result_id is not null and (new.course_id is null or new.semester_id is null) then
    select course_id, semester_id into new.course_id, new.semester_id from public.course_result where id = new.result_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_reval_fill on public.reval_request;
create trigger trg_reval_fill before insert on public.reval_request for each row execute function public.reval_fill();

insert into public.notification_event_type (key, label, urgent, channels, sort) values ('revaluation_decided', 'Revaluation or retotalling decided', false, '{email}', 72)
on conflict (key) do nothing;

-- grace marks for some students of a semester (first attempt), counting grace already given
create or replace function public.apply_grace(p_semester bigint, p_students bigint[]) returns void
language sql security definer set search_path = '' as $$
  update public.course_result cr set grace = g.need, passed = true, grade = g.pgrade, point = g.ppoint,
    percent = round((coalesce(cr.cia, 0) + coalesce(cr.ese, 0) + g.need) / nullif(coalesce(cr.cia_max, 0) + coalesce(cr.ese_max, 0), 0) * 100, 2)
  from (
    select x.id, x.need, x.pgrade, x.ppoint, x.grace_total, x.grace_course, x.used,
           sum(x.need) over (partition by x.student_id order by x.need, x.id) running
    from (
      select cr2.id, cr2.student_id, es.grace_per_course grace_course, es.grace_total,
        coalesce((select sum(u.grace) from public.course_result u where u.student_id = cr2.student_id and u.semester_id = p_semester and u.attempt = 1 and u.grace is not null), 0) used,
        round(greatest(es.pass_percent / 100.0 * (coalesce(cr2.cia_max, 0) + coalesce(cr2.ese_max, 0)) - (coalesce(cr2.cia, 0) + coalesce(cr2.ese, 0)),
                       case when es.ese_min_percent is not null then es.ese_min_percent / 100.0 * coalesce(cr2.ese_max, 0) - coalesce(cr2.ese, 0) else 0 end, 0), 2) need,
        (select eg.grade from public.eval_grade eg where eg.scheme_id = es.id and eg.min_percent <= es.pass_percent order by eg.min_percent desc limit 1) pgrade,
        (select eg.point from public.eval_grade eg where eg.scheme_id = es.id and eg.min_percent <= es.pass_percent order by eg.min_percent desc limit 1) ppoint
      from public.course_result cr2 join public.semester sm on sm.id = cr2.semester_id
      cross join lateral (select x.* from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class cl on cl.id = sec.class_id
                          join public.programme p on p.id = cl.programme_id join public.eval_scheme x on x.id = p.eval_scheme_id
                          where e.student_id = cr2.student_id and e.academic_year_id = sm.academic_year_id order by (e.status = 'active') desc limit 1) es
      where cr2.semester_id = p_semester and cr2.attempt = 1 and cr2.student_id = any(p_students) and not cr2.passed and cr2.grade <> 'Ab'
        and coalesce(es.grace_per_course, 0) > 0) x) g
  where cr.id = g.id and g.need > 0 and g.need <= g.grace_course and g.used + g.running <= coalesce(g.grace_total, g.grace_course) and g.pgrade is not null;
$$;
revoke all on function public.apply_grace(bigint, bigint[]) from public, anon, authenticated;

-- CGPA of every published semester of some students (all courses up to that semester, the attempt that counts)
create or replace function public.refresh_cgpa(p_students bigint[]) returns void
language sql security definer set search_path = '' as $$
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
      where cr.student_id = me.student_id and cs.starts_on <= ms.starts_on and cr.counts
      order by cr.course_id, cs.starts_on desc, cr.attempt desc) l
    where me.student_id = any(p_students)
    group by me.id) x
  where sr.id = x.id;
$$;
revoke all on function public.refresh_cgpa(bigint[]) from public, anon, authenticated;

-- after a revision: decided revaluations are applied again to the new rows
create or replace function public.reapply_revaluations(p_semester bigint, p_students bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_scheme bigint; g record; v_new bigint;
begin
  for r in select rq.* from public.reval_request rq where rq.semester_id = p_semester and rq.status = 'revised'
           and exists (select 1 from public.course_result cr where cr.semester_id = p_semester and cr.course_id = rq.course_id and cr.attempt = 1 and cr.student_id = any(p_students)
                       and cr.student_id = rq.student_id) loop
    select cr.id into v_new from public.course_result cr where cr.semester_id = p_semester and cr.course_id = r.course_id and cr.student_id = r.student_id and cr.attempt = 1;
    select p.eval_scheme_id into v_scheme from public.student_enrollment e join public.semester s on s.id = p_semester and s.academic_year_id = e.academic_year_id
      join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
     where e.student_id = r.student_id order by (e.status = 'active') desc limit 1;
    select g2.* into g from public.course_result cr, lateral public.grade_course(v_scheme, cr.cia, cr.cia_max, r.new_ese, cr.ese_max, false) g2 where cr.id = v_new;
    update public.course_result set ese = r.new_ese, percent = g.percent, grade = g.grade, point = g.point, passed = g.passed, grace = null where id = v_new;
    update public.reval_request set result_id = v_new where id = r.id;
  end loop;
  perform public.apply_grace(p_semester, p_students);
end $$;
revoke all on function public.reapply_revaluations(bigint, bigint[]) from public, anon, authenticated;

create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_sem public.semester; v_cr jsonb; v_ids bigint[]; v_redo bigint[]; v_by bigint := app.my_staff_id(); v_as text;
  v_revise boolean := coalesce(trim(p_revise_reason), '') <> '';
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  if v_sem.id is null then raise exception 'Unknown semester'; end if;
  v_as := public.staff_titles(v_by);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cr from public.compute_course_results(p_semester, p_section) c;

  -- who is published now: complete, and new or being revised
  with cr as (select * from jsonb_to_recordset(v_cr) as x(student_id bigint, status text)),
  st as (select cr.student_id, bool_and(cr.status in ('pass', 'fail', 'absent')) complete,
                exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = cr.student_id) done
         from cr group by cr.student_id)
  select coalesce(array_agg(student_id) filter (where complete and (not done or v_revise)), '{}'),
         coalesce(array_agg(student_id) filter (where complete and done and v_revise), '{}')
    into v_ids, v_redo from st;
  if cardinality(v_ids) = 0 then return 0; end if;

  -- revising: keep the old rows, then replace them
  if cardinality(v_redo) > 0 then
    insert into public.course_result_revision (school_id, revised_by, reason, old)
    select v_school, v_by, left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr
     where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_redo);
    delete from public.course_result where semester_id = p_semester and attempt = 1 and student_id = any(v_redo);
  end if;

  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
  select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
  from jsonb_to_recordset(v_cr) as c(student_id bigint, course_id bigint, credits numeric, cia numeric, cia_max numeric, ese numeric, ese_max numeric,
                                     percent numeric, grade text, point numeric, passed boolean, status text)
  where c.student_id = any(v_ids);

  -- grace marks within the scheme's limits
  perform public.apply_grace(p_semester, v_ids);

  -- the semester line per student (failed courses count in the GPA unless the scheme says otherwise)
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by, published_as)
  select v_school, p_semester, cr.student_id,
    f.semester_no,
    sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
    round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(f.fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(f.fail_counts, true)), 0), 2),
    null, count(*) filter (where not cr.passed), v_by, v_as
  from public.course_result cr
  left join lateral (
    select es.fail_counts_in_gpa fail_counts, (2 * c.year_no - case when v_sem.kind = 'odd' then 1 else 0 end)::smallint semester_no
    from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
    where e.student_id = cr.student_id and e.academic_year_id = v_sem.academic_year_id order by (e.status = 'active') desc limit 1) f on true
  where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_ids)
  group by cr.student_id, f.fail_counts, f.semester_no
  on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
    sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by,
    published_as = excluded.published_as, published_at = now();

  -- revaluations already decided stay applied after a revision
  perform public.reapply_revaluations(p_semester, v_ids);
  -- CGPA of every published semester of these students
  perform public.refresh_cgpa(v_ids);

  return cardinality(v_ids);
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
             left(case when s.kind = 'improvement' then 'Improvement exam fee: ' else 'Supplementary exam fee: ' end || s.name || ' (' || per.c || ' course' || case when per.c > 1 then 's' else '' end || ') #' || s.id || '-' || per.first_id, 160),
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
            left(initcap(p_kind) || ' fee: ' || (select code from public.course where id = cr.course_id) || ' #' || v_id, 160), v_fee, (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.reval_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting';
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
    perform public.notify_safe(cr.school_id, 'revaluation_decided', 'reval:' || r.id, null, null, cr.student_id, jsonb_build_object('request', r.id),
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
  perform public.notify_safe(cr.school_id, 'revaluation_decided', 'reval:' || r.id, null, null, cr.student_id, jsonb_build_object('request', r.id),
    initcap(r.kind) || ' result', (select code from public.course where id = cr.course_id) || ': ' || coalesce(r.old_grade, '') || ' to ' || coalesce((select grade from public.course_result where id = cr.id), ''), '/dashboard/results');
  return 'revised';
end $$;

-- the student (or the exam cell) withdraws a request that is still waiting; an unpaid fee is cancelled
create or replace function public.withdraw_revaluation(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reval_request;
begin
  select * into r from public.reval_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' then raise exception 'Only a waiting request can be withdrawn'; end if;
  if not (app.owns_student(r.student_id) or app.is_exams()) then raise exception 'Not allowed'; end if;
  update public.reval_request set status = 'withdrawn', decided_at = now() where id = r.id;
  update public.fee_invoice set status = 'cancelled' where id = r.invoice_id and status = 'due' and coalesce(paid_amount, 0) = 0;
end $$;
revoke all on function public.withdraw_revaluation(bigint) from public, anon;
grant execute on function public.withdraw_revaluation(bigint) to authenticated;

drop function if exists public.rank_list(bigint, bigint);
create or replace function public.rank_list(p_semester bigint, p_programme bigint default null)
returns table (rank int, student_id bigint, student_name text, admission_no text, programme text, sgpa numeric, semester_no smallint)
language sql stable security definer set search_path = '' as $$
  select rank() over (partition by x.programme_id, x.semester_no order by x.sgpa desc, x.pct desc)::int, x.student_id, x.full_name, x.admission_no, x.programme, x.sgpa, x.semester_no
  from (
    select sr.student_id, st.full_name, st.admission_no, sr.sgpa, sr.semester_no, g.id programme_id, g.name programme,
      (select avg(cr.percent) from public.course_result cr where cr.student_id = sr.student_id and cr.semester_id = sr.semester_id and cr.attempt = 1) pct
    from public.semester_result sr join public.student st on st.id = sr.student_id join public.semester s on s.id = sr.semester_id
    cross join lateral (select e.section_id from public.student_enrollment e where e.student_id = sr.student_id and e.academic_year_id = s.academic_year_id
                        order by (e.status = 'active') desc limit 1) e
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id
    where sr.semester_id = p_semester and sr.school_id = public.current_school_id() and sr.backlogs = 0 and sr.sgpa is not null
      and public.result_hold_reason(sr.student_id, sr.semester_id, false) is null
      and not exists (select 1 from public.course_result cr where cr.student_id = sr.student_id and cr.semester_id = sr.semester_id and cr.grace is not null)
      and not exists (select 1 from public.reval_request rq join public.course_result cr on cr.id = rq.result_id where cr.student_id = sr.student_id and cr.semester_id = sr.semester_id and rq.status = 'revised' and rq.old_grade in ('F', 'Ab'))
      and (p_programme is null or g.id = p_programme)
      and (app.is_exams() or coalesce(app.is_admin_scope(), false) or g.id in (select app.my_scope_programmes()))) x
  order by x.programme, x.semester_no, 1, x.full_name;
$$;
grant execute on function public.rank_list(bigint, bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
