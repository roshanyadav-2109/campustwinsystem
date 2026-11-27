-- Higher education, steps 6 and 8: internal assessment (CIA), end-semester
-- exam (ESE) and the grading engine.
-- An evaluation scheme (per programme) says which exam types make the CIA
-- and the ESE, how several tests combine (sum / average / best N) and their
-- weight; the pass minimums (ESE and overall); and the grade scale (UGC
-- 10-point by default: O, A+, A, B+, B, C, P, F).
-- compute_course_results previews a section's results for a semester from
-- the marks of the courses each student registered for. Publishing freezes
-- course results and works out SGPA (credits x grade points / credits) and
-- CGPA (all published semesters, latest attempt of each course).
-- Marks of a semester's exams carry term 1 (odd) or 2 (even).
begin;
create table if not exists public.eval_scheme (
  id              bigint generated always as identity primary key,
  school_id       bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  ese_min_percent numeric(5,2) check (ese_min_percent is null or ese_min_percent between 0 and 100),
  pass_percent    numeric(5,2) not null default 40 check (pass_percent between 0 and 100),
  unique (school_id, name)
);
create table if not exists public.eval_component (
  id                 bigint generated always as identity primary key,
  school_id          bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id          bigint not null references public.eval_scheme(id) on delete cascade,
  part               text not null check (part in ('cia', 'ese')),
  name               text not null check (char_length(name) between 1 and 60),
  assessment_type_id bigint not null references public.assessment_type(id) on delete restrict,
  rule               text not null default 'sum' check (rule in ('sum', 'average', 'best')),
  best_n             smallint check (best_n is null or best_n between 1 and 10),
  weight             numeric(6,2) not null check (weight > 0),
  check (rule <> 'best' or best_n is not null)
);
create table if not exists public.eval_grade (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id   bigint not null references public.eval_scheme(id) on delete cascade,
  min_percent numeric(5,2) not null check (min_percent between 0 and 100),
  grade       text not null check (char_length(grade) between 1 and 4),
  point       numeric(4,2) not null check (point between 0 and 10),
  unique (scheme_id, min_percent)
);
alter table public.programme add column if not exists eval_scheme_id bigint references public.eval_scheme(id) on delete set null;

create table if not exists public.course_result (
  id           bigint generated always as identity primary key,
  school_id    bigint not null references public.school(id) on delete cascade,
  semester_id  bigint not null references public.semester(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  course_id    bigint not null references public.course(id) on delete restrict,
  attempt      smallint not null default 1,
  credits      numeric(4,1) not null,
  cia          numeric(6,2), cia_max numeric(6,2),
  ese          numeric(6,2), ese_max numeric(6,2),
  percent      numeric(5,2),
  grade        text not null,
  point        numeric(4,2) not null,
  passed       boolean not null,
  published_at timestamptz not null default now(),
  unique (semester_id, student_id, course_id, attempt)
);
create index if not exists idx_course_result_student on public.course_result (student_id);
create table if not exists public.semester_result (
  id                 bigint generated always as identity primary key,
  school_id          bigint not null references public.school(id) on delete cascade,
  semester_id        bigint not null references public.semester(id) on delete cascade,
  student_id         bigint not null references public.student(id) on delete cascade,
  semester_no        smallint,
  credits_registered numeric(5,1) not null,
  credits_earned     numeric(5,1) not null,
  sgpa               numeric(4,2),
  cgpa               numeric(4,2),
  backlogs           int not null default 0,
  verify_token       text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  published_at       timestamptz not null default now(),
  unique (semester_id, student_id)
);

do $$ declare t text; begin
  foreach t in array array['eval_scheme', 'eval_component', 'eval_grade', 'course_result', 'semester_result'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on public.eval_scheme, public.eval_component, public.eval_grade to authenticated;
do $$ declare t text; begin
  foreach t in array array['eval_scheme', 'eval_component', 'eval_grade'] loop
    execute format('drop policy if exists ev_read on public.%I', t);
    execute format('create policy ev_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists ev_write on public.%I', t);
    execute format('create policy ev_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
  end loop;
end $$;
-- results: written only by publishing; read by staff, the student and their parents
revoke insert, update, delete on public.course_result, public.semester_result from authenticated;
grant select on public.course_result, public.semester_result to authenticated;
drop policy if exists crs_read on public.course_result;
create policy crs_read on public.course_result for select to authenticated using ((select app.my_staff_id()) is not null or app.owns_student(student_id));
drop policy if exists srs_read on public.semester_result;
create policy srs_read on public.semester_result for select to authenticated using ((select app.my_staff_id()) is not null or app.owns_student(student_id));

create or replace function public.eval_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_higher_ed(new.school_id) then raise exception 'Evaluation schemes are for colleges and universities'; end if;
  if tg_table_name in ('eval_component', 'eval_grade') then
    if not exists (select 1 from public.eval_scheme s where s.id = new.scheme_id and s.school_id = new.school_id) then raise exception 'That scheme is not at this institution'; end if;
  end if;
  if tg_table_name = 'eval_component' then
    if not exists (select 1 from public.assessment_type t where t.id = new.assessment_type_id and t.school_id = new.school_id and t.is_numeric) then raise exception 'Choose an exam type with marks'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['eval_scheme', 'eval_component', 'eval_grade'] loop
    execute format('drop trigger if exists trg_eval_same_school on public.%I', t);
    execute format('create trigger trg_eval_same_school before insert or update on public.%I for each row execute function public.eval_same_school()', t);
  end loop;
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
  tests as (
    select g.sid, g.course_id, comp.id comp_id, comp.part, comp.rule, comp.best_n, comp.weight, a.id aid, a.max_marks
    from regs g
    join public.eval_component comp on comp.scheme_id = g.sch
    join public.subject sb on sb.course_id = g.course_id and sb.school_id = v_school
    join public.assessment a on a.subject_id = sb.id and a.section_id = p_section and a.academic_year_id = s.academic_year_id
                            and a.term = v_term and a.assessment_type_id = comp.assessment_type_id),
  comp_scores as (
    select t.sid, t.course_id, t.comp_id, t.part, t.rule, t.best_n, t.weight,
      count(*) n_tests, count(m.id) filter (where not m.is_exempt) n_held,
      coalesce(sum(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained, t.max_marks) end) filter (where m.id is not null and not m.is_exempt), 0) obt,
      coalesce(sum(t.max_marks) filter (where m.id is not null and not m.is_exempt), 0) poss,
      array_agg(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained / nullif(t.max_marks, 0), 1) end order by 1)
        filter (where m.id is not null and not m.is_exempt) fr
    from tests t left join public.mark m on m.assessment_id = t.aid and m.student_id = t.sid
    group by t.sid, t.course_id, t.comp_id, t.part, t.rule, t.best_n, t.weight),
  scored as (
    select cs.*,
      case when cs.n_held = 0 then null
           when cs.rule = 'sum' then cs.obt / nullif(cs.poss, 0) * cs.weight
           when cs.rule = 'average' then (select avg(x) from unnest(cs.fr) x) * cs.weight
           else coalesce((select sum(x) from (select x from unnest(cs.fr) x order by x desc limit cs.best_n) b), 0) / least(cs.best_n, cs.n_held) * cs.weight end score
    from comp_scores cs),
  parts as (
    select g.sid, g.course_id,
      sum(sc.score) filter (where sc.part = 'cia') cia, sum(sc.weight) filter (where sc.part = 'cia') cia_max,
      sum(sc.score) filter (where sc.part = 'ese') ese, sum(sc.weight) filter (where sc.part = 'ese') ese_max,
      bool_or(sc.part = 'ese' and sc.score is null) ese_missing, bool_or(sc.part = 'ese') has_ese
    from regs g left join scored sc on sc.sid = g.sid and sc.course_id = g.course_id
    group by g.sid, g.course_id)
  select g.sid, g.full_name, g.roll, g.course_id, g.code, g.cname, g.credits,
    round(pt.cia, 2), (select sum(weight) from public.eval_component where scheme_id = g.sch and part = 'cia'),
    round(pt.ese, 2), (select sum(weight) from public.eval_component where scheme_id = g.sch and part = 'ese'),
    r.pct, case when r.ok then gr.grade else 'F' end, case when r.ok then gr.point else 0 end, r.ok,
    case when g.sch is null then 'no_scheme' when not coalesce(pt.has_ese, false) or pt.ese_missing then 'incomplete' when r.ok then 'pass' else 'fail' end
  from regs g
  left join parts pt on pt.sid = g.sid and pt.course_id = g.course_id
  left join public.eval_scheme es on es.id = g.sch
  left join lateral (
    select round((coalesce(pt.cia, 0) + coalesce(pt.ese, 0)) / nullif(coalesce(pt.cia_max, 0) + coalesce(pt.ese_max, 0), 0) * 100, 2) pct) p0 on true
  left join lateral (
    select p0.pct,
      p0.pct is not null and p0.pct >= es.pass_percent
      and (es.ese_min_percent is null or coalesce(pt.ese, 0) / nullif(pt.ese_max, 0) * 100 >= es.ese_min_percent) ok) r on true
  left join lateral (
    select eg.grade, eg.point from public.eval_grade eg where eg.scheme_id = g.sch and r.pct is not null and eg.min_percent <= r.pct order by eg.min_percent desc limit 1) gr on true
  order by g.roll nulls last, g.full_name, g.code;
end $$;
grant execute on function public.compute_course_results(bigint, bigint) to authenticated;

-- ---------- publish ----------
-- Freezes the section's results for the semester (students whose every
-- course is complete), and works out SGPA and CGPA.
create or replace function public.publish_semester_results(p_semester bigint, p_section bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); r record; n int := 0; v_sem public.semester;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can publish results'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  create temporary table if not exists tmp_cr on commit drop as select * from public.compute_course_results(p_semester, p_section) limit 0;
  delete from tmp_cr;
  insert into tmp_cr select * from public.compute_course_results(p_semester, p_section);
  for r in select t.student_id from tmp_cr t group by t.student_id having bool_and(t.status in ('pass', 'fail')) loop
    delete from public.course_result where semester_id = p_semester and student_id = r.student_id and attempt = 1;
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, p_semester, t.student_id, t.course_id, 1, t.credits, t.cia, t.cia_max, t.ese, t.ese_max, t.percent, t.grade, coalesce(t.point, 0), t.passed
    from tmp_cr t where t.student_id = r.student_id;
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) / nullif(sum(cr.credits), 0), 2), null,
      count(*) filter (where not cr.passed)
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_at = now();
    -- CGPA: every published course, its latest attempt
    update public.semester_result sr set cgpa = x.cgpa from (
      select round(sum(l.credits * l.point) / nullif(sum(l.credits), 0), 2) cgpa from (
        select distinct on (cr.course_id) cr.credits, cr.point from public.course_result cr where cr.student_id = r.student_id
        order by cr.course_id, cr.published_at desc, cr.attempt desc) l) x
    where sr.semester_id = p_semester and sr.student_id = r.student_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.publish_semester_results(bigint, bigint) from public, anon;
grant execute on function public.publish_semester_results(bigint, bigint) to authenticated;

create or replace function public.verify_grade_card(p_token text)
returns table (valid boolean, student_name text, programme text, semester_no smallint, sgpa numeric, cgpa numeric, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select st.status <> 'left', st.full_name,
    (select p.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
      join public.semester s2 on s2.academic_year_id = e.academic_year_id where e.student_id = st.id and s2.id = sr.semester_id limit 1),
    sr.semester_no, sr.sgpa, sr.cgpa, sc.name, (sr.published_at at time zone 'Asia/Kolkata')::date
  from public.semester_result sr join public.student st on st.id = sr.student_id join public.school sc on sc.id = sr.school_id
  where sr.verify_token = p_token and length(p_token) between 20 and 64;
$$;
grant execute on function public.verify_grade_card(text) to anon, authenticated;
commit;
