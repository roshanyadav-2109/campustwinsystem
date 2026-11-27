-- Grading engine, after the product + CTO review of 0126-0128.
begin;
alter table public.eval_scheme add column if not exists fail_counts_in_gpa boolean not null default true;
alter table public.semester_result add column if not exists withheld_reason text check (withheld_reason is null or char_length(withheld_reason) <= 200);
alter table public.semester_result add column if not exists published_by bigint references public.staff(id) on delete set null;

-- earlier versions of results, kept when the office revises them
create table if not exists public.course_result_revision (
  id          bigint generated always as identity primary key,
  school_id   bigint not null references public.school(id) on delete cascade,
  revised_at  timestamptz not null default now(),
  revised_by  bigint references public.staff(id) on delete set null,
  reason      text not null,
  old         jsonb not null
);
alter table public.course_result_revision enable row level security;
drop policy if exists crr_read on public.course_result_revision;
create policy crr_read on public.course_result_revision for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
revoke all on public.course_result_revision from anon, authenticated;
grant select on public.course_result_revision to authenticated;
grant all on public.course_result_revision to service_role;

-- a grade scale must have a passing grade with points at the pass mark
create or replace function public.eval_scale_check(p_scheme bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pass numeric;
begin
  select pass_percent into v_pass from public.eval_scheme where id = p_scheme;
  if v_pass is not null and exists (select 1 from public.eval_grade where scheme_id = p_scheme)
     and coalesce((select point from public.eval_grade where scheme_id = p_scheme and min_percent <= v_pass order by min_percent desc limit 1), 0) <= 0 then
    raise exception 'The grade at the pass mark (% %%) must have grade points above 0', v_pass;
  end if;
end $$;

-- ---------- preview ----------
create or replace function public.compute_course_results(p_semester bigint, p_section bigint)
returns table (student_id bigint, student_name text, roll_no int, course_id bigint, course_code text, course_name text, credits numeric,
               cia numeric, cia_max numeric, ese numeric, ese_max numeric, percent numeric, grade text, point numeric, passed boolean, status text)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_term smallint;
begin
  select * into s from public.semester where id = p_semester and school_id = v_school;
  if s.id is null or s.kind not in ('odd', 'even') then raise exception 'Choose an odd or even semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then raise exception 'Not allowed'; end if;
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
grant execute on function public.compute_course_results(bigint, bigint) to authenticated;

-- CGPA of each published semester of a student: every course up to that
-- semester, its latest attempt (by semester date, then attempt)
create or replace function public.recompute_cgpa(p_student bigint) returns void
language sql security definer set search_path = '' as $$
  update public.semester_result sr set cgpa = x.cgpa
  from (
    select me.id, round(sum(l.credits * l.point) filter (where l.counts) / nullif(sum(l.credits) filter (where l.counts), 0), 2) cgpa
    from public.semester_result me join public.semester ms on ms.id = me.semester_id
    cross join lateral (
      select distinct on (cr.course_id) cr.credits, cr.point,
        (cr.passed or coalesce((select es.fail_counts_in_gpa from public.programme p join public.eval_scheme es on es.id = p.eval_scheme_id
                                 join public.programme_course pc on pc.programme_id = p.id and pc.course_id = cr.course_id limit 1), true)) counts
      from public.course_result cr join public.semester cs on cs.id = cr.semester_id
      where cr.student_id = me.student_id and cs.starts_on <= ms.starts_on
      order by cr.course_id, cs.starts_on desc, cr.attempt desc) l
    where me.student_id = p_student
    group by me.id) x
  where sr.id = x.id;
$$;
revoke all on function public.recompute_cgpa(bigint) from public, anon, authenticated;

-- ---------- publish ----------
-- Students already published are left as they are, unless p_revise_reason
-- is given (their old results are kept in course_result_revision).
drop function if exists public.publish_semester_results(bigint, bigint);
create function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int := 0; r record; v_sem public.semester; v_min numeric; v_short text; v_fail_counts boolean;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can publish results'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  select attendance_minimum into v_min from public.school where id = v_school;
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
    -- attendance shortage (not condoned) holds the result back
    select string_agg(x.sname, ', ') into v_short from (
      select sb.name sname from public.attendance_record a join public.subject sb on sb.id = a.subject_id
      where a.student_id = r.student_id and a.period is not null and a.subject_id is not null and a.on_date between v_sem.starts_on and v_sem.ends_on
      group by sb.id, sb.name
      having 100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min
         and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = p_semester and cd.student_id = r.student_id and cd.subject_id = sb.id)) x;
    select coalesce(es.fail_counts_in_gpa, true) into v_fail_counts
      from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
      join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
     where e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id limit 1;
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, withheld_reason, published_by)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(v_fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(v_fail_counts, true)), 0), 2),
      null, count(*) filter (where not cr.passed),
      case when v_short is not null then 'Attendance below ' || v_min || '% in ' || v_short end, app.my_staff_id()
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, withheld_reason = excluded.withheld_reason,
      published_by = excluded.published_by, published_at = now();
    perform public.recompute_cgpa(r.student_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.publish_semester_results(bigint, bigint, text) from public, anon;
grant execute on function public.publish_semester_results(bigint, bigint, text) to authenticated;

-- the office holds back or releases a published result
create or replace function public.withhold_result(p_semester bigint, p_student bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can hold back results'; end if;
  update public.semester_result set withheld_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
   where semester_id = p_semester and student_id = p_student and school_id = public.current_school_id();
end $$;
revoke all on function public.withhold_result(bigint, bigint, text) from public, anon;
grant execute on function public.withhold_result(bigint, bigint, text) to authenticated;

-- students and parents see a result only when it is not held back
drop policy if exists srs_read on public.semester_result;
create policy srs_read on public.semester_result for select to authenticated
  using ((select app.my_staff_id()) is not null or (app.owns_student(student_id) and withheld_reason is null));
drop policy if exists crs_read on public.course_result;
create policy crs_read on public.course_result for select to authenticated
  using ((select app.my_staff_id()) is not null
         or (app.owns_student(student_id) and exists (select 1 from public.semester_result sr where sr.semester_id = course_result.semester_id and sr.student_id = course_result.student_id and sr.withheld_reason is null)));

-- marks behind a published result cannot change (revise the result instead)
create or replace function public.guard_published_marks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a record; v_sid bigint := coalesce(new.student_id, old.student_id);
begin
  select a.academic_year_id, a.term, sb.course_id into v_a from public.assessment a join public.subject sb on sb.id = a.subject_id where a.id = coalesce(new.assessment_id, old.assessment_id);
  if v_a.course_id is not null and exists (
       select 1 from public.course_result cr join public.semester s on s.id = cr.semester_id
       where cr.student_id = v_sid and cr.course_id = v_a.course_id and s.academic_year_id = v_a.academic_year_id
         and (case s.kind when 'odd' then 1 when 'even' then 2 end) = v_a.term) then
    raise exception 'This mark is part of a published result. The office revises the result with a reason first.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_published_marks on public.mark;
create trigger trg_guard_published_marks before insert or update or delete on public.mark for each row execute function public.guard_published_marks();

create or replace function public.verify_grade_card(p_token text)
returns table (valid boolean, student_name text, programme text, semester_no smallint, sgpa numeric, cgpa numeric, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select st.status <> 'left', st.full_name,
    (select p.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
      join public.semester s2 on s2.academic_year_id = e.academic_year_id where e.student_id = st.id and s2.id = sr.semester_id limit 1),
    sr.semester_no, sr.sgpa, sr.cgpa, sc.name, (sr.published_at at time zone 'Asia/Kolkata')::date
  from public.semester_result sr join public.student st on st.id = sr.student_id join public.school sc on sc.id = sr.school_id
  where sr.verify_token = p_token and length(p_token) between 20 and 64 and sr.withheld_reason is null;
$$;
commit;
grant execute on function public.eval_scale_check(bigint) to authenticated;
notify pgrst, 'reload schema';
