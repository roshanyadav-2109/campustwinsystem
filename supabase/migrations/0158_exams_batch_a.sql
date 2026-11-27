-- Exams batch A (colleges and universities): revaluation and retotalling,
-- improvement exams (the better attempt counts), grace marks, rank list,
-- CGPA-to-percentage conversion, and the data for the supplementary memo and
-- the consolidated marksheet.
begin;
alter table public.course_result add column if not exists kind text not null default 'regular' check (kind in ('regular', 'supplementary', 'improvement'));
alter table public.course_result add column if not exists counts boolean not null default true;
alter table public.course_result add column if not exists grace numeric(6,2);
alter table public.eval_scheme add column if not exists grace_per_course numeric(6,2) check (grace_per_course is null or grace_per_course >= 0);
alter table public.eval_scheme add column if not exists grace_total numeric(6,2) check (grace_total is null or grace_total >= 0);
alter table public.school add column if not exists cgpa_pct_multiplier numeric(5,2) check (cgpa_pct_multiplier is null or cgpa_pct_multiplier > 0);
alter table public.school add column if not exists cgpa_pct_offset numeric(5,2) not null default 0;
alter table public.school add column if not exists reval_fee numeric(10,2) check (reval_fee is null or reval_fee >= 0);
alter table public.school add column if not exists retotal_fee numeric(10,2) check (retotal_fee is null or retotal_fee >= 0);
alter table public.school add column if not exists reval_window_days smallint not null default 15 check (reval_window_days between 0 and 90);

-- earlier supplementary attempts are supplementary
update public.course_result set kind = 'supplementary' where attempt > 1 and kind = 'regular';

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

  -- grace marks: a course failed by no more than the scheme's grace per course is passed at the pass grade,
  -- smallest shortfalls first, within the grace allowed per student for the semester (recorded on the course)
  update public.course_result cr set grace = g.need, passed = true, grade = g.pgrade, point = g.ppoint,
    percent = round((coalesce(cr.cia, 0) + coalesce(cr.ese, 0) + g.need) / nullif(coalesce(cr.cia_max, 0) + coalesce(cr.ese_max, 0), 0) * 100, 2)
  from (
    select x.id, x.need, x.pgrade, x.ppoint, x.grace_total, sum(x.need) over (partition by x.student_id order by x.need, x.id) running, x.grace_course
    from (
      select cr2.id, cr2.student_id, es.grace_per_course grace_course, es.grace_total,
        round(greatest(es.pass_percent / 100.0 * (coalesce(cr2.cia_max, 0) + coalesce(cr2.ese_max, 0)) - (coalesce(cr2.cia, 0) + coalesce(cr2.ese, 0)),
                       case when es.ese_min_percent is not null then es.ese_min_percent / 100.0 * coalesce(cr2.ese_max, 0) - coalesce(cr2.ese, 0) else 0 end, 0), 2) need,
        (select eg.grade from public.eval_grade eg where eg.scheme_id = es.id and eg.min_percent <= es.pass_percent order by eg.min_percent desc limit 1) pgrade,
        (select eg.point from public.eval_grade eg where eg.scheme_id = es.id and eg.min_percent <= es.pass_percent order by eg.min_percent desc limit 1) ppoint
      from public.course_result cr2
      cross join lateral (select x.* from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class cl on cl.id = sec.class_id
                          join public.programme p on p.id = cl.programme_id join public.eval_scheme x on x.id = p.eval_scheme_id
                          where e.student_id = cr2.student_id and e.academic_year_id = v_sem.academic_year_id order by (e.status = 'active') desc limit 1) es
      where cr2.semester_id = p_semester and cr2.attempt = 1 and cr2.student_id = any(v_ids) and not cr2.passed and cr2.grade <> 'Ab'
        and coalesce(es.grace_per_course, 0) > 0) x) g
  where cr.id = g.id and g.need > 0 and g.need <= g.grace_course and g.running <= coalesce(g.grace_total, g.grace_course) and g.ppoint > 0;

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

  -- CGPA of every published semester of these students: all courses up to that semester, latest attempt
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
    where me.student_id = any(v_ids)
    group by me.id) x
  where sr.id = x.id;

  return cardinality(v_ids);
end $$;

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
  return n;
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
        or (s.kind = 'improvement' and l.passed and not exists (select 1 from public.course_result ix where ix.student_id = l.student_id and ix.course_id = l.course_id and ix.kind = 'improvement')))
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
  where app.owns_student(p_student) or app.my_staff_id() is not null
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
    and (app.my_staff_id() is not null or app.owns_student(p_student))
  order by sr.semester_no nulls last, c.code;
$$;

create or replace function public.semester_backlogs(p_semester bigint)
returns table (student_id bigint, student_name text, admission_no text, course_id bigint, course_code text, course_name text, attempts int)
language sql stable security definer set search_path = '' as $$
  select l.student_id, st.full_name, st.admission_no, l.course_id, c.code, c.name, l.attempts
  from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.passed,
               count(*) over (partition by cr.student_id, cr.course_id)::int attempts
        from public.course_result cr where cr.semester_id = p_semester and cr.school_id = public.current_school_id() and cr.counts
        order by cr.student_id, cr.course_id, cr.attempt desc) l
  join public.student st on st.id = l.student_id join public.course c on c.id = l.course_id
  where not l.passed and (app.is_exams() or coalesce(app.is_admin_scope(), false))
  order by st.full_name, c.code;
$$;

drop function if exists public.open_supplementary(bigint);
create or replace function public.open_supplementary(p_student bigint)
returns table (session_id bigint, session_name text, for_semester_id bigint, fee_per_course numeric, registration_closes date, kind text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.for_semester_id, s.fee_per_course, s.registration_closes, s.kind from public.exam_session s
  where s.school_id = public.current_school_id() and s.kind in ('supplementary', 'improvement') and s.self_registration
    and (s.registration_closes is null or s.registration_closes >= (now() at time zone 'Asia/Kolkata')::date)
    and (app.owns_student(p_student) or app.my_staff_id() is not null)
  order by s.created_at desc;
$$;
grant execute on function public.open_supplementary(bigint) to authenticated;

-- ---------- grading one course from its parts (shared by revaluation) ----------
create or replace function public.grade_course(p_scheme bigint, p_cia numeric, p_cia_max numeric, p_ese numeric, p_ese_max numeric, p_absent boolean default false)
returns table (percent numeric, grade text, point numeric, passed boolean)
language sql stable security definer set search_path = '' as $$
  with es as (select * from public.eval_scheme where id = p_scheme),
  pct as (select round((coalesce(p_cia, 0) + coalesce(p_ese, 0)) / nullif(coalesce(p_cia_max, 0) + coalesce(p_ese_max, 0), 0) * 100, 2) v,
                 round(coalesce(p_ese, 0) / nullif(p_ese_max, 0) * 100, 2) ese_v),
  ok as (select not p_absent and pct.v >= es.pass_percent and (es.ese_min_percent is null or p_ese_max is null or coalesce(pct.ese_v, 0) >= es.ese_min_percent) v from es, pct)
  select pct.v,
    case when p_absent then 'Ab' when ok.v then coalesce((select eg.grade from public.eval_grade eg where eg.scheme_id = p_scheme and eg.min_percent <= pct.v order by eg.min_percent desc limit 1), 'P') else 'F' end,
    case when ok.v then coalesce((select eg.point from public.eval_grade eg where eg.scheme_id = p_scheme and eg.min_percent <= pct.v order by eg.min_percent desc limit 1), 0) else 0 end,
    ok.v
  from pct, ok;
$$;
revoke all on function public.grade_course(bigint, numeric, numeric, numeric, numeric, boolean) from public, anon, authenticated;

-- the semester line again after a correction (revaluation changes the issued result, as universities reissue it)
create or replace function public.refresh_semester_line(p_student bigint, p_semester bigint) returns void
language sql security definer set search_path = '' as $$
  update public.semester_result sr set
    credits_registered = x.reg, credits_earned = x.earned, backlogs = x.bl,
    sgpa = round(x.pts / nullif(x.cr, 0), 2)
  from (select sum(cr.credits) reg, coalesce(sum(cr.credits) filter (where cr.passed), 0) earned, count(*) filter (where not cr.passed) bl,
               sum(cr.credits * cr.point) filter (where cr.passed or coalesce(f.fc, true)) pts, sum(cr.credits) filter (where cr.passed or coalesce(f.fc, true)) cr
        from public.course_result cr
        left join lateral (select es.fail_counts_in_gpa fc from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                           join public.programme p on p.id = c.programme_id join public.eval_scheme es on es.id = p.eval_scheme_id
                           where e.student_id = p_student order by (e.status = 'active') desc limit 1) f on true
        where cr.student_id = p_student and cr.semester_id = p_semester and cr.attempt = 1) x
  where sr.student_id = p_student and sr.semester_id = p_semester;
$$;
revoke all on function public.refresh_semester_line(bigint, bigint) from public, anon, authenticated;

-- ---------- revaluation and retotalling ----------
create table if not exists public.reval_request (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  result_id   bigint not null references public.course_result(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  kind        text not null check (kind in ('revaluation', 'retotalling')),
  status      text not null default 'requested' check (status in ('requested', 'revised', 'no_change', 'rejected', 'withdrawn')),
  invoice_id  bigint references public.fee_invoice(id) on delete set null,
  old_ese     numeric(6,2),
  new_ese     numeric(6,2),
  old_grade   text,
  new_grade   text,
  note        text check (note is null or char_length(note) <= 300),
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_by  bigint references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index if not exists uq_reval_open on public.reval_request (result_id, kind) where status = 'requested';
alter table public.reval_request enable row level security;
drop policy if exists tenant_isolation on public.reval_request;
create policy tenant_isolation on public.reval_request as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists rv_read on public.reval_request;
create policy rv_read on public.reval_request for select to authenticated using ((select app.is_exams()) or (select app.is_admin_scope()) or app.owns_student(student_id));
revoke all on public.reval_request from anon, authenticated;
grant select on public.reval_request to authenticated;
grant all on public.reval_request to service_role;

-- a student or parent asks (within the window after publishing), or the exam cell records a request
create or replace function public.request_revaluation(p_result bigint, p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); cr public.course_result; sc public.school; v_fee numeric; v_inv bigint; v_id bigint; v_year bigint;
begin
  select * into cr from public.course_result where id = p_result and school_id = v_school;
  if cr.id is null then raise exception 'Unknown result'; end if;
  if p_kind not in ('revaluation', 'retotalling') then raise exception 'Choose revaluation or retotalling'; end if;
  if not (app.owns_student(cr.student_id) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if cr.grade = 'Ab' then raise exception 'There is no answer script to revalue (absent)'; end if;
  if public.result_hold(cr.student_id, cr.semester_id) is not null and not app.is_exams() then raise exception 'This result is held back'; end if;
  select * into sc from public.school where id = v_school;
  if not app.is_exams() and cr.published_at::date + sc.reval_window_days < (now() at time zone 'Asia/Kolkata')::date then
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
revoke all on function public.request_revaluation(bigint, text) from public, anon;
grant execute on function public.request_revaluation(bigint, text) to authenticated;

-- the exam cell decides: the revised end-semester marks (on the course's end-semester scale), or no change.
-- A revised result replaces the issued one; the old row is kept in course_result_revision.
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
    return 'no_change';
  end if;
  if p_new_ese < 0 or p_new_ese > coalesce(cr.ese_max, 0) then raise exception 'Marks must be between 0 and %', cr.ese_max; end if;
  select p.eval_scheme_id into v_scheme from public.student_enrollment e join public.semester s on s.id = cr.semester_id and s.academic_year_id = e.academic_year_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
   where e.student_id = cr.student_id order by (e.status = 'active') desc limit 1;
  select * into g from public.grade_course(v_scheme, cr.cia, cr.cia_max, p_new_ese, cr.ese_max, false);
  insert into public.course_result_revision (school_id, revised_by, reason, old) values (cr.school_id, app.my_staff_id(), left(initcap(r.kind) || ' #' || r.id, 200), to_jsonb(cr));
  update public.course_result set ese = p_new_ese, percent = g.percent, grade = g.grade, point = g.point, passed = g.passed, grace = null where id = cr.id;
  update public.reval_request set status = 'revised', new_ese = p_new_ese, new_grade = g.grade, note = left(p_note, 300), decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
  if cr.attempt = 1 then perform public.refresh_semester_line(cr.student_id, cr.semester_id); end if;
  return 'revised';
end $$;
revoke all on function public.decide_revaluation(bigint, numeric, text) from public, anon;
grant execute on function public.decide_revaluation(bigint, numeric, text) to authenticated;

-- ---------- rank list and percentage ----------
create or replace function public.rank_list(p_semester bigint, p_programme bigint default null)
returns table (rank int, student_id bigint, student_name text, admission_no text, programme text, sgpa numeric)
language sql stable security definer set search_path = '' as $$
  select dense_rank() over (partition by g.id order by sr.sgpa desc)::int, st.id, st.full_name, st.admission_no, g.name, sr.sgpa
  from public.semester_result sr join public.student st on st.id = sr.student_id
  join public.semester s on s.id = sr.semester_id
  join public.student_enrollment e on e.student_id = sr.student_id and e.academic_year_id = s.academic_year_id
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id
  where sr.semester_id = p_semester and sr.school_id = public.current_school_id() and sr.backlogs = 0 and sr.sgpa is not null
    and not exists (select 1 from public.course_result cr where cr.student_id = sr.student_id and cr.semester_id = sr.semester_id and cr.grace is not null)
    and (p_programme is null or g.id = p_programme)
    and (app.is_exams() or coalesce(app.is_admin_scope(), false) or g.id in (select app.my_scope_programmes()))
  order by g.name, 1, st.full_name;
$$;
grant execute on function public.rank_list(bigint, bigint) to authenticated;

create or replace function public.cgpa_percent(p_cgpa numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when s.cgpa_pct_multiplier is null or p_cgpa is null then null else round(greatest(p_cgpa - s.cgpa_pct_offset, 0) * s.cgpa_pct_multiplier, 2) end
  from public.school s where s.id = public.current_school_id();
$$;
grant execute on function public.cgpa_percent(numeric) to authenticated;

-- ---------- the consolidated marksheet and the supplementary memo ----------
create or replace function public.student_consolidated(p_student bigint)
returns table (semester_id bigint, semester_no smallint, course_code text, course_name text, credits numeric, grade text, point numeric, attempt smallint, kind text, passed boolean)
language sql stable security definer set search_path = '' as $$
  select l.semester_id, sr.semester_no, c.code, c.name, l.credits, l.grade, l.point, l.attempt, l.kind, l.passed
  from (select distinct on (cr.course_id) cr.* from public.course_result cr
        where cr.student_id = p_student and cr.school_id = public.current_school_id() and cr.counts order by cr.course_id, cr.attempt desc) l
  join public.course c on c.id = l.course_id
  left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = p_student
  where (app.owns_student(p_student) and public.result_hold(p_student, l.semester_id) is null) or app.my_staff_id() is not null
  order by sr.semester_no nulls last, c.code;
$$;
grant execute on function public.student_consolidated(bigint) to authenticated;

create or replace function public.student_supp_results(p_student bigint)
returns table (session_id bigint, session_name text, kind text, published_on date, course_code text, course_name text, credits numeric, attempt smallint, grade text, point numeric, passed boolean, counts boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.kind, (cr.published_at at time zone 'Asia/Kolkata')::date, c.code, c.name, cr.credits, cr.attempt, cr.grade, cr.point, cr.passed, cr.counts
  from public.supp_registration r join public.exam_session s on s.id = r.session_id join public.course_result cr on cr.id = r.result_id join public.course c on c.id = r.course_id
  where r.student_id = p_student and r.school_id = public.current_school_id() and r.status = 'published'
    and (app.owns_student(p_student) or app.my_staff_id() is not null)
  order by s.created_at desc, c.code;
$$;
grant execute on function public.student_supp_results(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
