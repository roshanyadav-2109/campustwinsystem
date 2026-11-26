-- Report cards: a configurable system, not a fixed board format.
--
-- A school defines any number of report-card SCHEMES (e.g. one per board it
-- follows) and assigns one to each class for a year; a section can use a
-- different one (schools that run two boards). A scheme has:
--   terms          the report periods (term 1, term 2 ...; number = assessment.term)
--   components     what counts, per term: an exam type, how several tests of
--                  it combine (sum / average / best N), and what it is scaled to
--   grade bands    percent ranges -> grade, grade point, remark
--   co-scholastic  areas graded by teachers (art, discipline ...), with the grades allowed
--   pass rule      optional minimum percent per subject and overall
-- The computation runs in the database (whole sections, no row limits).
-- Class teachers enter co-scholastic grades and remarks; the office or class
-- teacher LOCKS a term (marks can no longer change) and PUBLISHES report cards:
-- a frozen snapshot per student, with a public check code for the QR.
begin;

create table if not exists public.report_scheme (
  id            bigint generated always as identity primary key,
  school_id     bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  board         text check (board is null or char_length(board) <= 60),
  pass_percent  numeric(5,2) check (pass_percent is null or pass_percent between 0 and 100),
  show_marks    boolean not null default true,
  show_grades   boolean not null default true,
  show_percent  boolean not null default true,
  final_label   text not null default 'Final result' check (char_length(final_label) <= 60),
  notes         text check (notes is null or char_length(notes) <= 1000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.report_scheme_term (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id   bigint not null references public.report_scheme(id) on delete cascade,
  term        smallint not null check (term between 1 and 6),
  name        text not null check (char_length(name) between 1 and 60),
  starts_on   date,
  ends_on     date,
  final_weight numeric(6,2) check (final_weight is null or final_weight >= 0),   -- share in the final result; null = equal
  unique (scheme_id, term),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.report_scheme_component (
  id                 bigint generated always as identity primary key,
  school_id          bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id          bigint not null references public.report_scheme(id) on delete cascade,
  term               smallint not null check (term between 1 and 6),
  name               text not null check (char_length(name) between 1 and 60),
  assessment_type_id bigint not null references public.assessment_type(id) on delete restrict,
  rule               text not null default 'sum' check (rule in ('sum', 'average', 'best')),
  best_n             smallint check (best_n is null or best_n between 1 and 20),
  out_of             numeric(7,2) not null check (out_of > 0),
  sort               smallint not null default 0,
  check (rule <> 'best' or best_n is not null)
);
create index if not exists idx_rsc_scheme on public.report_scheme_component (scheme_id, term, sort);

create table if not exists public.report_grade_band (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id    bigint not null references public.report_scheme(id) on delete cascade,
  min_percent  numeric(5,2) not null check (min_percent between 0 and 100),
  grade        text not null check (char_length(grade) between 1 and 10),
  grade_point  numeric(4,2),
  remark       text check (remark is null or char_length(remark) <= 60),
  unique (scheme_id, min_percent)
);

create table if not exists public.report_coscholastic_area (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id  bigint not null references public.report_scheme(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  grades     text[] not null default '{A,B,C}' check (cardinality(grades) between 2 and 10),
  sort       smallint not null default 0,
  unique (scheme_id, name)
);

-- which scheme a class (or one section) uses this year
create table if not exists public.report_scheme_assignment (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  class_id         bigint not null references public.class(id) on delete cascade,
  section_id       bigint references public.section(id) on delete cascade,
  scheme_id        bigint not null references public.report_scheme(id) on delete restrict
);
create unique index if not exists uq_rsa on public.report_scheme_assignment (academic_year_id, class_id, coalesce(section_id, 0));

-- teacher entries
create table if not exists public.report_coscholastic_grade (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  student_id       bigint not null references public.student(id) on delete cascade,
  area_id          bigint not null references public.report_coscholastic_area(id) on delete cascade,
  term             smallint not null check (term between 1 and 6),
  grade            text not null check (char_length(grade) <= 10),
  entered_by       bigint references public.staff(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (student_id, academic_year_id, area_id, term)
);
create table if not exists public.report_remark (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  student_id       bigint not null references public.student(id) on delete cascade,
  term             smallint not null check (term between 0 and 6),   -- 0 = final
  remark           text not null check (char_length(remark) <= 500),
  entered_by       bigint references public.staff(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (student_id, academic_year_id, term)
);

-- lock: marks of a section for a term can no longer change
create table if not exists public.report_lock (
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  section_id       bigint not null references public.section(id) on delete cascade,
  term             smallint not null check (term between 1 and 6),
  locked_by        bigint references public.staff(id) on delete set null,
  locked_at        timestamptz not null default now(),
  primary key (academic_year_id, section_id, term)
);

-- published report cards: a frozen snapshot
create table if not exists public.report_card (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  student_id       bigint not null references public.student(id) on delete cascade,
  section_id       bigint not null references public.section(id) on delete cascade,
  term             smallint not null check (term between 0 and 6),   -- 0 = final result
  scheme_id        bigint references public.report_scheme(id) on delete set null,
  snapshot         jsonb not null,
  status           text not null default 'published' check (status in ('published', 'withdrawn')),
  verify_token     text not null default encode(extensions.gen_random_bytes(18), 'hex') unique,
  published_by     bigint references public.staff(id) on delete set null,
  published_at     timestamptz not null default now(),
  withdrawn_reason text
);
create unique index if not exists uq_report_card_live on public.report_card (student_id, academic_year_id, term) where status = 'published';
create index if not exists idx_report_card_section on public.report_card (section_id, academic_year_id, term);

-- ---------- security ----------
do $$ declare t text; begin
  foreach t in array array['report_scheme','report_scheme_term','report_scheme_component','report_grade_band','report_coscholastic_area',
                           'report_scheme_assignment','report_coscholastic_grade','report_remark','report_lock','report_card'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- scheme setup: everyone at the institution may read (teachers need it); office writes
do $$ declare t text; begin
  foreach t in array array['report_scheme','report_scheme_term','report_scheme_component','report_grade_band','report_coscholastic_area','report_scheme_assignment'] loop
    execute format('drop policy if exists rs_read on public.%I', t);
    execute format('create policy rs_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists rs_write on public.%I', t);
    execute format('create policy rs_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
  end loop;
end $$;

-- class teacher of the student's section (this year), or the office; principal reads
create or replace function app.is_ct_of_student(p_student bigint, p_year bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.student_enrollment e
                 where e.student_id = p_student and e.academic_year_id = p_year and app.ct_of_section(e.section_id, p_year));
$$;
grant execute on function app.is_ct_of_student(bigint, bigint) to authenticated;

drop policy if exists rcg_read on public.report_coscholastic_grade;
create policy rcg_read on public.report_coscholastic_grade for select to authenticated
  using ((select app.is_admin_scope()) or app.is_ct_of_student(student_id, academic_year_id));
drop policy if exists rcg_write on public.report_coscholastic_grade;
create policy rcg_write on public.report_coscholastic_grade for all to authenticated
  using ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id))
  with check ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id));
drop policy if exists rr_read on public.report_remark;
create policy rr_read on public.report_remark for select to authenticated
  using ((select app.is_admin_scope()) or app.is_ct_of_student(student_id, academic_year_id));
drop policy if exists rr_write on public.report_remark;
create policy rr_write on public.report_remark for all to authenticated
  using ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id))
  with check ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id));
drop policy if exists rl_read on public.report_lock;
create policy rl_read on public.report_lock for select to authenticated using (true);
drop policy if exists rl_write on public.report_lock;
create policy rl_write on public.report_lock for all to authenticated
  using ((select app.is_office()) or app.ct_of_section(section_id, academic_year_id))
  with check ((select app.is_office()) or app.ct_of_section(section_id, academic_year_id));
-- report cards: staff who see the section; the student and their parents once published
drop policy if exists rc_read on public.report_card;
create policy rc_read on public.report_card for select to authenticated
  using ((select app.is_admin_scope()) or app.ct_of_section(section_id, academic_year_id)
         or (status = 'published' and app.can_view_student(student_id)));
-- written only through publish_report_cards(); withdrawn by office
drop policy if exists rc_withdraw on public.report_card;
create policy rc_withdraw on public.report_card for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
revoke insert, delete on public.report_card from authenticated;
revoke update on public.report_card from authenticated;
grant update (status, withdrawn_reason) on public.report_card to authenticated;

-- a published card can be withdrawn, never changed or restored
create or replace function public.guard_report_card() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'withdrawn' then raise exception 'A withdrawn report card cannot be changed'; end if;
  if new.status = 'withdrawn' and coalesce(trim(new.withdrawn_reason), '') = '' then raise exception 'Give a reason to withdraw a report card'; end if;
  if new.snapshot is distinct from old.snapshot or new.student_id <> old.student_id or new.term <> old.term then raise exception 'A published report card cannot be edited'; end if;
  return new;
end $$;
drop trigger if exists trg_guard_report_card on public.report_card;
create trigger trg_guard_report_card before update on public.report_card for each row execute function public.guard_report_card();

-- marks of a locked term cannot change (for anyone, including the office)
create or replace function public.guard_locked_marks() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a record;
begin
  select a.section_id, a.academic_year_id, a.term into v_a from public.assessment a where a.id = coalesce(new.assessment_id, old.assessment_id);
  if v_a.term is not null and exists (select 1 from public.report_lock l where l.section_id = v_a.section_id and l.academic_year_id = v_a.academic_year_id and l.term = v_a.term) then
    raise exception 'Marks for this term are locked for report cards. Ask the office to unlock the term first.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_locked_marks on public.mark;
create trigger trg_guard_locked_marks before insert or update or delete on public.mark for each row execute function public.guard_locked_marks();

-- ---------- computation ----------
-- The scheme a section uses this year (section choice, else its class's).
create or replace function public.report_scheme_for(p_section bigint, p_year bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select a.scheme_id from public.report_scheme_assignment a join public.section s on s.id = p_section
  where a.academic_year_id = p_year and a.class_id = s.class_id and (a.section_id = p_section or a.section_id is null)
    and a.school_id = public.current_school_id()
  order by a.section_id nulls last limit 1;
$$;
grant execute on function public.report_scheme_for(bigint, bigint) to authenticated;

-- One section's report for a term (0 = final, all terms). One json object per
-- student: subjects -> components -> score, totals, percent, grade; overall;
-- attendance in the term dates; co-scholastic grades; remark.
create or replace function public.compute_report(p_section bigint, p_year bigint, p_term smallint)
returns table (student_id bigint, report jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_scheme bigint; v_school bigint := public.current_school_id(); v_s public.report_scheme;
begin
  if not (app.is_admin_scope() or app.ct_of_section(p_section, p_year) or app.teaches_section(p_section, p_year)) then
    raise exception 'You cannot see report cards for this section';
  end if;
  v_scheme := public.report_scheme_for(p_section, p_year);
  if v_scheme is null then raise exception 'No report card scheme is chosen for this class yet (Settings, Exams)'; end if;
  select * into v_s from public.report_scheme where id = v_scheme;

  return query
  with kids as (
    select e.student_id sid, st.full_name, st.admission_no, e.roll_no
    from public.student_enrollment e join public.student st on st.id = e.student_id
    where e.section_id = p_section and e.academic_year_id = p_year and e.school_id = v_school and e.status = 'active'),
  comps as (
    select c.* from public.report_scheme_component c where c.scheme_id = v_scheme and (p_term = 0 or c.term = p_term)),
  subj as (
    select distinct a.subject_id from public.assessment a join comps c on c.assessment_type_id = a.assessment_type_id and c.term = a.term
    where a.section_id = p_section and a.academic_year_id = p_year),
  -- every (student, component, subject) with the fractions of each test of it
  scores as (
    select k.sid, c.id comp_id, c.term, c.name comp_name, c.sort, c.rule, c.best_n, c.out_of, a.subject_id,
           array_agg(case when m.is_absent or m.marks_obtained is null then null else least(m.marks_obtained / nullif(a.max_marks, 0), 1) end
                     order by case when m.is_absent or m.marks_obtained is null then -1 else m.marks_obtained / nullif(a.max_marks, 0) end desc) fr,
           count(m.id) n_marked, count(a.id) n_tests
    from kids k cross join comps c
    join public.assessment a on a.assessment_type_id = c.assessment_type_id and a.term = c.term and a.section_id = p_section and a.academic_year_id = p_year
    left join public.mark m on m.assessment_id = a.id and m.student_id = k.sid
    group by k.sid, c.id, c.term, c.name, c.sort, c.rule, c.best_n, c.out_of, a.subject_id),
  comp_score as (
    select s.*,
      case
        when s.n_marked = 0 then null                                    -- no marks at all: not applicable
        when s.rule = 'sum' then (select coalesce(sum(x), 0) from unnest(s.fr) x) / s.n_tests * s.out_of
        when s.rule = 'average' then coalesce((select avg(x) from unnest(s.fr) x where x is not null), 0) * s.out_of
        else coalesce((select avg(x) from (select x from unnest(s.fr) x where x is not null order by x desc limit s.best_n) b), 0)
             * least((select count(*) from unnest(s.fr) x where x is not null), s.best_n) / s.best_n * s.out_of
      end score
    from scores s),
  subj_total as (
    select cs.sid, cs.subject_id,
      sum(cs.score) filter (where cs.score is not null) total,
      sum(cs.out_of) filter (where cs.score is not null) max_total,
      jsonb_agg(jsonb_build_object('term', cs.term, 'name', cs.comp_name, 'out_of', cs.out_of,
                                   'score', case when cs.score is null then null else round(cs.score, 2) end) order by cs.term, cs.sort, cs.comp_name) components
    from comp_score cs group by cs.sid, cs.subject_id),
  graded as (
    select t.*, case when t.max_total > 0 then round(t.total / t.max_total * 100, 2) end pct
    from subj_total t),
  subj_json as (
    select g.sid,
      jsonb_agg(jsonb_build_object('subject_id', g.subject_id, 'subject', sb.name, 'components', g.components,
        'total', round(g.total, 2), 'max', g.max_total, 'percent', g.pct,
        'grade', (select b.grade from public.report_grade_band b where b.scheme_id = v_scheme and g.pct is not null and b.min_percent <= g.pct order by b.min_percent desc limit 1),
        'passed', case when v_s.pass_percent is null or g.pct is null then null else g.pct >= v_s.pass_percent end)
        order by sb.name) subjects,
      sum(g.total) gt, sum(g.max_total) gm,
      bool_and(case when v_s.pass_percent is null or g.pct is null then true else g.pct >= v_s.pass_percent end) all_passed,
      count(*) filter (where g.pct is null) n_na
    from graded g join public.subject sb on sb.id = g.subject_id group by g.sid),
  att as (
    select k.sid,
      count(*) filter (where ar.status in ('present', 'late')) present,
      count(*) filter (where ar.status in ('present', 'late', 'absent', 'leave')) working
    from kids k
    left join public.report_scheme_term tt on tt.scheme_id = v_scheme and (p_term = 0 or tt.term = p_term)
    left join public.attendance_record ar on ar.student_id = k.sid and ar.academic_year_id = p_year and ar.period is null
         and tt.starts_on is not null and ar.on_date between tt.starts_on and coalesce(tt.ends_on, tt.starts_on)
    group by k.sid),
  cosch as (
    select g.student_id sid, jsonb_agg(jsonb_build_object('area', ar.name, 'term', g.term, 'grade', g.grade) order by ar.sort, ar.name, g.term) items
    from public.report_coscholastic_grade g join public.report_coscholastic_area ar on ar.id = g.area_id and ar.scheme_id = v_scheme
    where g.academic_year_id = p_year and (p_term = 0 or g.term = p_term) and g.student_id in (select sid from kids)
    group by g.student_id),
  rem as (
    select r.student_id sid, r.remark from public.report_remark r
    where r.academic_year_id = p_year and r.term = p_term and r.student_id in (select sid from kids))
  select k.sid,
    jsonb_build_object(
      'student', jsonb_build_object('id', k.sid, 'name', k.full_name, 'admission_no', k.admission_no, 'roll_no', k.roll_no),
      'scheme', jsonb_build_object('id', v_s.id, 'name', v_s.name, 'board', v_s.board, 'show_marks', v_s.show_marks,
                                   'show_grades', v_s.show_grades, 'show_percent', v_s.show_percent, 'pass_percent', v_s.pass_percent,
                                   'final_label', v_s.final_label),
      'term', p_term,
      'term_name', case when p_term = 0 then v_s.final_label else (select tt.name from public.report_scheme_term tt where tt.scheme_id = v_scheme and tt.term = p_term) end,
      'subjects', coalesce(sj.subjects, '[]'::jsonb),
      'total', round(sj.gt, 2), 'max', sj.gm,
      'percent', case when sj.gm > 0 then round(sj.gt / sj.gm * 100, 2) end,
      'grade', (select b.grade from public.report_grade_band b where b.scheme_id = v_scheme and sj.gm > 0 and b.min_percent <= round(sj.gt / sj.gm * 100, 2) order by b.min_percent desc limit 1),
      'result', case when sj.subjects is null then 'no_marks'
                     when v_s.pass_percent is null then null
                     when sj.all_passed and (sj.gm = 0 or sj.gt / sj.gm * 100 >= v_s.pass_percent) then 'pass' else 'needs_improvement' end,
      'incomplete', coalesce(sj.n_na, 0) > 0,
      'attendance', case when a.working > 0 then jsonb_build_object('present', a.present, 'working', a.working) end,
      'coscholastic', coalesce(c.items, '[]'::jsonb),
      'remark', rm.remark)
  from kids k
  left join subj_json sj on sj.sid = k.sid
  left join att a on a.sid = k.sid
  left join cosch c on c.sid = k.sid
  left join rem rm on rm.sid = k.sid
  order by k.roll_no nulls last, k.full_name;
end $$;
grant execute on function public.compute_report(bigint, bigint, smallint) to authenticated;

-- Publish: freeze each student's report (all, or the chosen students).
-- A term must be locked first; the final result needs every term locked.
create or replace function public.publish_report_cards(p_section bigint, p_year bigint, p_term smallint, p_students bigint[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_scheme bigint; v_n int := 0; r record; v_missing text;
begin
  if not (app.is_office() or app.ct_of_section(p_section, p_year)) then raise exception 'Only the office or the class teacher can publish report cards'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  v_scheme := public.report_scheme_for(p_section, p_year);
  if v_scheme is null then raise exception 'No report card scheme is chosen for this class yet'; end if;
  select string_agg(t.name, ', ' order by t.term) into v_missing from public.report_scheme_term t
   where t.scheme_id = v_scheme and (p_term = 0 or t.term = p_term)
     and not exists (select 1 from public.report_lock l where l.section_id = p_section and l.academic_year_id = p_year and l.term = t.term);
  if v_missing is not null then raise exception 'Lock the marks first: %', v_missing; end if;

  for r in select * from public.compute_report(p_section, p_year, p_term) c where p_students is null or c.student_id = any(p_students) loop
    if r.report ->> 'result' = 'no_marks' then continue; end if;
    update public.report_card set status = 'withdrawn', withdrawn_reason = 'Published again'
      where student_id = r.student_id and academic_year_id = p_year and term = p_term and status = 'published';
    insert into public.report_card (school_id, academic_year_id, student_id, section_id, term, scheme_id, snapshot, published_by)
    values (v_school, p_year, r.student_id, p_section, p_term, v_scheme,
            r.report || jsonb_build_object('school', (select jsonb_build_object('name', s.name, 'place', s.place, 'board', s.affiliation_board,
                                                       'affiliation_no', s.affiliation_no, 'school_code', s.board_school_code, 'udise', s.udise_code,
                                                       'signatory', s.signatory_name, 'signatory_title', s.signatory_title)
                                                      from public.school s where s.id = v_school),
                                          'class', (select c.name || '-' || sec.name from public.section sec join public.class c on c.id = sec.class_id where sec.id = p_section),
                                          'year', (select y.name from public.academic_year y where y.id = p_year)),
            app.my_staff_id());
    v_n := v_n + 1;
    -- tell the parents (inbox, and channels the school switched on)
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (v_school, 'result_published', currval(pg_get_serial_sequence('public.report_card', 'id')), jsonb_build_object('student_id', r.student_id));
  end loop;
  return v_n;
end $$;
grant execute on function public.publish_report_cards(bigint, bigint, smallint, bigint[]) to authenticated;

-- public check of a printed report card (QR): who, which term, which school; no marks
create or replace function public.verify_report_card(p_token text)
returns table (valid boolean, reason text, student_name text, class_label text, term_name text, year_name text, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select rc.status = 'published', case when rc.status = 'published' then 'Valid report card' else 'This report card was withdrawn' end,
         rc.snapshot -> 'student' ->> 'name', rc.snapshot ->> 'class', rc.snapshot ->> 'term_name', rc.snapshot ->> 'year',
         rc.snapshot -> 'school' ->> 'name', (rc.published_at at time zone 'Asia/Kolkata')::date
  from public.report_card rc where rc.verify_token = p_token and length(p_token) between 20 and 64;
$$;
grant execute on function public.verify_report_card(text) to anon, authenticated;
commit;
