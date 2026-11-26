-- Report cards, after the product + CTO review of 0095.
-- Security: every child row must belong to the same institution as its
--   scheme / section / student; definer functions filter by institution.
-- Lock: also guards exams (assessment) and mark moves; only the office unlocks.
-- Computation: sum = marks obtained / marks possible (not a mean of
--   fractions); absent counts 0; EXEMPT (new mark flag) is left out; a test
--   not yet entered makes the subject "incomplete" instead of shrinking it
--   silently; best-of divides by the tests actually held; one rounding for
--   grade and pass; students who changed section keep their earlier marks.
-- Model: components can apply to some subjects only (theory / practical);
--   per-subject mode (counted, shown but not counted, hidden) and order;
--   overall pass mark; grade point and remark of the band; attendance
--   entered by hand per term; promotion result text with the final remark.
begin;

alter table public.mark add column if not exists is_exempt boolean not null default false;

alter table public.report_scheme add column if not exists overall_pass_percent numeric(5,2) check (overall_pass_percent is null or overall_pass_percent between 0 and 100);
alter table public.report_scheme_term drop column if exists final_weight;
alter table public.report_scheme_term drop constraint if exists report_scheme_term_dates_both;
alter table public.report_scheme_term add constraint report_scheme_term_dates_both check ((starts_on is null) = (ends_on is null));
alter table public.report_scheme_component add column if not exists subject_ids bigint[];
alter table public.report_scheme_component drop constraint if exists report_scheme_component_term_fk;
alter table public.report_scheme_component add constraint report_scheme_component_term_fk
  foreign key (scheme_id, term) references public.report_scheme_term (scheme_id, term) on delete cascade;
alter table public.report_remark add column if not exists result_text text check (result_text is null or char_length(result_text) <= 120);

create table if not exists public.report_scheme_subject (
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  scheme_id  bigint not null references public.report_scheme(id) on delete cascade,
  subject_id bigint not null references public.subject(id) on delete cascade,
  mode       text not null default 'counted' check (mode in ('counted', 'not_counted', 'hidden')),
  sort       smallint not null default 0,
  primary key (scheme_id, subject_id)
);
create table if not exists public.report_attendance (
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  student_id       bigint not null references public.student(id) on delete cascade,
  term             smallint not null check (term between 0 and 6),
  present          smallint not null check (present >= 0),
  working          smallint not null check (working > 0),
  primary key (student_id, academic_year_id, term),
  check (present <= working)
);
do $$ declare t text; begin
  foreach t in array array['report_scheme_subject', 'report_attendance'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists rs_read on public.report_scheme_subject;
create policy rs_read on public.report_scheme_subject for select to authenticated using (true);
drop policy if exists rs_write on public.report_scheme_subject;
create policy rs_write on public.report_scheme_subject for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
drop policy if exists ra_read on public.report_attendance;
create policy ra_read on public.report_attendance for select to authenticated using ((select app.is_admin_scope()) or app.is_ct_of_student(student_id, academic_year_id));
drop policy if exists ra_write on public.report_attendance;
create policy ra_write on public.report_attendance for all to authenticated
  using ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id))
  with check ((select app.is_office()) or app.is_ct_of_student(student_id, academic_year_id));

-- ---------- same-institution guard on every reference ----------
create or replace function public.report_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ok boolean := true;
begin
  if tg_table_name in ('report_scheme_term', 'report_scheme_component', 'report_grade_band', 'report_coscholastic_area', 'report_scheme_subject') then
    ok := exists (select 1 from public.report_scheme s where s.id = new.scheme_id and s.school_id = new.school_id);
    if ok and tg_table_name = 'report_scheme_component' then
      ok := exists (select 1 from public.assessment_type t where t.id = new.assessment_type_id and t.school_id = new.school_id and t.is_numeric);
      if not ok then raise exception 'Choose a numeric exam type of this institution'; end if;
      ok := new.subject_ids is null or not exists (select 1 from unnest(new.subject_ids) x where not exists (select 1 from public.subject sb where sb.id = x and sb.school_id = new.school_id));
    end if;
    if ok and tg_table_name = 'report_scheme_subject' then
      ok := exists (select 1 from public.subject sb where sb.id = new.subject_id and sb.school_id = new.school_id);
    end if;
  elsif tg_table_name = 'report_scheme_assignment' then
    ok := exists (select 1 from public.report_scheme s where s.id = new.scheme_id and s.school_id = new.school_id)
      and exists (select 1 from public.class c where c.id = new.class_id and c.school_id = new.school_id)
      and exists (select 1 from public.academic_year y where y.id = new.academic_year_id and y.school_id = new.school_id)
      and (new.section_id is null or exists (select 1 from public.section x where x.id = new.section_id and x.school_id = new.school_id and x.class_id = new.class_id));
  elsif tg_table_name in ('report_coscholastic_grade', 'report_remark', 'report_attendance') then
    ok := exists (select 1 from public.student st where st.id = new.student_id and st.school_id = new.school_id)
      and exists (select 1 from public.academic_year y where y.id = new.academic_year_id and y.school_id = new.school_id);
    if ok and tg_table_name = 'report_coscholastic_grade' then
      ok := exists (select 1 from public.report_coscholastic_area a where a.id = new.area_id and a.school_id = new.school_id and new.grade = any(a.grades));
      if not ok then raise exception 'That grade is not one of the grades of this area'; end if;
    end if;
  elsif tg_table_name = 'report_lock' then
    ok := exists (select 1 from public.section x where x.id = new.section_id and x.school_id = new.school_id);
  end if;
  if not ok then raise exception 'That record belongs to another institution'; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['report_scheme_term','report_scheme_component','report_grade_band','report_coscholastic_area','report_scheme_subject',
                           'report_scheme_assignment','report_coscholastic_grade','report_remark','report_attendance','report_lock'] loop
    execute format('drop trigger if exists trg_report_same_school on public.%I', t);
    execute format('create trigger trg_report_same_school before insert or update on public.%I for each row execute function public.report_same_school()', t);
  end loop;
end $$;

-- ---------- lock ----------
drop policy if exists rl_write on public.report_lock;
drop policy if exists rl_insert on public.report_lock;
create policy rl_insert on public.report_lock for insert to authenticated
  with check ((select app.is_office()) or app.ct_of_section(section_id, academic_year_id));
drop policy if exists rl_delete on public.report_lock;
create policy rl_delete on public.report_lock for delete to authenticated using ((select app.is_office()));
revoke update on public.report_lock from authenticated;

create or replace function public.term_locked(p_section bigint, p_year bigint, p_term smallint) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_term is not null and exists (select 1 from public.report_lock l where l.section_id = p_section and l.academic_year_id = p_year and l.term = p_term);
$$;

create or replace function public.guard_locked_marks() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select a.section_id, a.academic_year_id, a.term into v_a from public.assessment a where a.id = old.assessment_id;
    if public.term_locked(v_a.section_id, v_a.academic_year_id, v_a.term) then
      raise exception 'Marks for this term are locked for report cards. Ask the office to unlock the term first.';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select a.section_id, a.academic_year_id, a.term into v_a from public.assessment a where a.id = new.assessment_id;
    if public.term_locked(v_a.section_id, v_a.academic_year_id, v_a.term) then
      raise exception 'Marks for this term are locked for report cards. Ask the office to unlock the term first.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.guard_locked_assessment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.term_locked(old.section_id, old.academic_year_id, old.term) then
    if tg_op = 'DELETE' or new.max_marks is distinct from old.max_marks or new.term is distinct from old.term
       or new.assessment_type_id is distinct from old.assessment_type_id or new.section_id is distinct from old.section_id
       or new.subject_id is distinct from old.subject_id or new.academic_year_id is distinct from old.academic_year_id then
      raise exception 'This exam is in a term locked for report cards. Ask the office to unlock the term first.';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.term_locked(new.section_id, new.academic_year_id, new.term)
     and (tg_op = 'INSERT' or new.term is distinct from old.term or new.section_id is distinct from old.section_id) then
    raise exception 'This term is locked for report cards. Ask the office to unlock the term first.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_locked_assessment on public.assessment;
create trigger trg_guard_locked_assessment before insert or update or delete on public.assessment for each row execute function public.guard_locked_assessment();

-- ---------- computation ----------
drop function if exists public.compute_report(bigint, bigint, smallint);
create function public.compute_report(p_section bigint, p_year bigint, p_term smallint)
returns table (student_id bigint, report jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_scheme bigint; v_school bigint := public.current_school_id(); v_s public.report_scheme;
begin
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (app.is_admin_scope() or app.ct_of_section(p_section, p_year) or app.teaches_section(p_section, p_year)) then
    raise exception 'You cannot see report cards for this section';
  end if;
  v_scheme := public.report_scheme_for(p_section, p_year);
  if v_scheme is null then raise exception 'No report card scheme is chosen for this class yet (Settings, Report cards)'; end if;
  select * into v_s from public.report_scheme where id = v_scheme and school_id = v_school;

  return query
  with kids as (
    select e.student_id sid, st.full_name, st.admission_no, e.roll_no, e.status est
    from public.student_enrollment e join public.student st on st.id = e.student_id
    where e.section_id = p_section and e.academic_year_id = p_year and e.school_id = v_school),
  comps as (
    select c.* from public.report_scheme_component c where c.scheme_id = v_scheme and c.school_id = v_school and (p_term = 0 or c.term = p_term)),
  subj_mode as (
    select ss.subject_id, ss.mode, ss.sort from public.report_scheme_subject ss where ss.scheme_id = v_scheme),
  -- the tests each student sat: this section's, plus earlier sections' where they have marks
  kid_tests as (
    select k.sid, a.id aid, a.subject_id, a.term, a.assessment_type_id, a.max_marks
      from kids k join public.assessment a on a.section_id = p_section and a.academic_year_id = p_year and a.school_id = v_school
    union
    select k.sid, a.id, a.subject_id, a.term, a.assessment_type_id, a.max_marks
      from kids k join public.mark m on m.student_id = k.sid
      join public.assessment a on a.id = m.assessment_id and a.academic_year_id = p_year and a.school_id = v_school and a.section_id <> p_section),
  scores as (
    select kt.sid, c.id comp_id, c.term, c.name comp_name, c.sort, c.rule, c.best_n, c.out_of, kt.subject_id,
      count(*) n_tests,
      count(*) filter (where m.id is null) n_missing,
      count(*) filter (where m.is_exempt) n_exempt,
      count(*) filter (where m.id is not null and not m.is_exempt) n_held,
      coalesce(sum(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained, kt.max_marks) end)
               filter (where m.id is not null and not m.is_exempt), 0) obt,
      coalesce(sum(kt.max_marks) filter (where m.id is not null and not m.is_exempt), 0) poss,
      coalesce(sum(case when m.is_absent or m.marks_obtained is null then 0 else least(m.marks_obtained / nullif(kt.max_marks, 0), 1) end)
               filter (where m.id is not null and not m.is_exempt), 0) sum_fr,
      array_agg(least(m.marks_obtained / nullif(kt.max_marks, 0), 1) order by m.marks_obtained / nullif(kt.max_marks, 0) desc)
        filter (where m.id is not null and not m.is_exempt and not m.is_absent and m.marks_obtained is not null) fr
    from kid_tests kt
    join comps c on c.assessment_type_id = kt.assessment_type_id and c.term = kt.term and (c.subject_ids is null or kt.subject_id = any(c.subject_ids))
    left join public.mark m on m.assessment_id = kt.aid and m.student_id = kt.sid
    group by kt.sid, c.id, c.term, c.name, c.sort, c.rule, c.best_n, c.out_of, kt.subject_id),
  comp_score as (
    select s.*,
      case
        when s.n_held = 0 then null
        when s.rule = 'sum' then s.obt / nullif(s.poss, 0) * s.out_of
        when s.rule = 'average' then s.sum_fr / s.n_held * s.out_of
        else coalesce((select sum(x) from (select x from unnest(s.fr) x order by x desc limit s.best_n) b), 0) / least(s.best_n, s.n_held) * s.out_of
      end score,
      (s.n_missing > 0) missing
    from scores s),
  subj_total as (
    select cs.sid, cs.subject_id,
      sum(cs.score) filter (where cs.score is not null) total,
      sum(cs.out_of) filter (where cs.score is not null) max_total,
      bool_or(cs.missing) any_missing,
      jsonb_agg(jsonb_build_object('id', cs.comp_id, 'term', cs.term, 'name', cs.comp_name, 'out_of', cs.out_of,
                                   'score', case when cs.score is null then null else round(cs.score, 2) end,
                                   'absent', cs.n_held > 0 and cs.fr is null and cs.obt = 0 and cs.rule <> 'sum' or (cs.rule = 'sum' and cs.n_held > 0 and cs.obt = 0 and cs.fr is null),
                                   'exempt', cs.n_exempt = cs.n_tests, 'missing', cs.missing)
                order by cs.term, cs.sort, cs.comp_name) components
    from comp_score cs group by cs.sid, cs.subject_id),
  graded as (
    select t.*, coalesce(sm.mode, 'counted') mode, coalesce(sm.sort, 0) sort,
      case when t.max_total > 0 then round(t.total / t.max_total * 100, 2) end pct
    from subj_total t left join subj_mode sm on sm.subject_id = t.subject_id
    where coalesce(sm.mode, 'counted') <> 'hidden'),
  banded as (
    select g.*, b.grade, b.grade_point, b.remark band_remark
    from graded g left join lateral (
      select bb.grade, bb.grade_point, bb.remark from public.report_grade_band bb
      where bb.scheme_id = v_scheme and g.pct is not null and bb.min_percent <= g.pct order by bb.min_percent desc limit 1) b on true),
  subj_json as (
    select g.sid,
      jsonb_agg(jsonb_build_object('subject_id', g.subject_id, 'subject', sb.name, 'counted', g.mode = 'counted', 'components', g.components,
        'total', round(g.total, 2), 'max', g.max_total, 'percent', g.pct, 'grade', g.grade, 'grade_point', g.grade_point, 'grade_remark', g.band_remark,
        'incomplete', g.any_missing,
        'passed', case when v_s.pass_percent is null or g.pct is null or g.mode <> 'counted' then null else g.pct >= v_s.pass_percent end)
        order by g.sort, sb.name) subjects,
      sum(g.total) filter (where g.mode = 'counted') gt,
      sum(g.max_total) filter (where g.mode = 'counted') gm,
      bool_and(case when v_s.pass_percent is null or g.pct is null or g.mode <> 'counted' then true else g.pct >= v_s.pass_percent end) all_passed,
      bool_or(g.any_missing) any_missing,
      count(*) filter (where g.pct is null) n_na
    from banded g join public.subject sb on sb.id = g.subject_id group by g.sid),
  overall as (
    select sj.*, case when sj.gm > 0 then round(sj.gt / sj.gm * 100, 2) end opct from subj_json sj),
  att_calc as (
    select k.sid,
      count(ar.id) filter (where ar.status in ('present', 'late')) present,
      count(ar.id) filter (where ar.status in ('present', 'late', 'absent', 'leave')) working
    from kids k
    join public.report_scheme_term tt on tt.scheme_id = v_scheme and (p_term = 0 or tt.term = p_term) and tt.starts_on is not null
    left join public.attendance_record ar on ar.student_id = k.sid and ar.academic_year_id = p_year and ar.period is null
         and ar.on_date between tt.starts_on and tt.ends_on
    group by k.sid),
  cosch as (
    select g.student_id sid, jsonb_agg(jsonb_build_object('area', ar.name, 'term', g.term, 'grade', g.grade) order by ar.sort, ar.name, g.term) items
    from public.report_coscholastic_grade g join public.report_coscholastic_area ar on ar.id = g.area_id and ar.scheme_id = v_scheme
    where g.academic_year_id = p_year and (p_term = 0 or g.term = p_term) and g.student_id in (select sid from kids)
    group by g.student_id),
  rem as (
    select r.student_id sid, r.remark, r.result_text from public.report_remark r
    where r.academic_year_id = p_year and r.term = p_term and r.student_id in (select sid from kids)),
  att_manual as (
    select a.student_id sid, a.present, a.working from public.report_attendance a
    where a.academic_year_id = p_year and a.term = p_term and a.student_id in (select sid from kids))
  select k.sid,
    jsonb_build_object(
      'student', jsonb_build_object('id', k.sid, 'name', k.full_name, 'admission_no', k.admission_no, 'roll_no', k.roll_no, 'enrolment', k.est),
      'scheme', jsonb_build_object('id', v_s.id, 'name', v_s.name, 'board', v_s.board, 'show_marks', v_s.show_marks,
                                   'show_grades', v_s.show_grades, 'show_percent', v_s.show_percent, 'pass_percent', v_s.pass_percent,
                                   'overall_pass_percent', v_s.overall_pass_percent, 'final_label', v_s.final_label),
      'term', p_term,
      'term_name', case when p_term = 0 then v_s.final_label else (select tt.name from public.report_scheme_term tt where tt.scheme_id = v_scheme and tt.term = p_term) end,
      'subjects', coalesce(o.subjects, '[]'::jsonb),
      'total', round(o.gt, 2), 'max', o.gm, 'percent', o.opct,
      'grade', (select b.grade from public.report_grade_band b where b.scheme_id = v_scheme and o.opct is not null and b.min_percent <= o.opct order by b.min_percent desc limit 1),
      'result', case when o.subjects is null then 'no_marks'
                     when v_s.pass_percent is null and v_s.overall_pass_percent is null then null
                     when o.all_passed and (v_s.overall_pass_percent is null or coalesce(o.opct, 0) >= v_s.overall_pass_percent) then 'pass'
                     else 'needs_improvement' end,
      'incomplete', coalesce(o.any_missing, false) or coalesce(o.n_na, 0) > 0,
      'attendance', case when am.sid is not null then jsonb_build_object('present', am.present, 'working', am.working, 'entered', true)
                         when ac.working > 0 then jsonb_build_object('present', ac.present, 'working', ac.working, 'entered', false) end,
      'coscholastic', coalesce(c.items, '[]'::jsonb),
      'remark', rm.remark,
      'result_text', rm.result_text)
  from kids k
  left join overall o on o.sid = k.sid
  left join att_calc ac on ac.sid = k.sid
  left join att_manual am on am.sid = k.sid
  left join cosch c on c.sid = k.sid
  left join rem rm on rm.sid = k.sid
  order by k.roll_no nulls last, k.full_name;
end $$;
grant execute on function public.compute_report(bigint, bigint, smallint) to authenticated;

-- republishing replaces the old card quietly (parents are told once per term)
create or replace function public.publish_report_cards(p_section bigint, p_year bigint, p_term smallint, p_students bigint[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_scheme bigint; v_n int := 0; r record; v_missing text; v_card bigint; v_ct text;
begin
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (app.is_office() or app.ct_of_section(p_section, p_year)) then raise exception 'Only the office or the class teacher can publish report cards'; end if;
  v_scheme := public.report_scheme_for(p_section, p_year);
  if v_scheme is null then raise exception 'No report card scheme is chosen for this class yet'; end if;
  select string_agg(t.name, ', ' order by t.term) into v_missing from public.report_scheme_term t
   where t.scheme_id = v_scheme and (p_term = 0 or t.term = p_term)
     and not exists (select 1 from public.report_lock l where l.section_id = p_section and l.academic_year_id = p_year and l.term = t.term);
  if v_missing is not null then raise exception 'Lock the marks first: %', v_missing; end if;
  select string_agg(distinct st.full_name, ', ') into v_ct from public.teacher_allotment ta join public.staff st on st.id = ta.staff_id
   where ta.section_id = p_section and ta.academic_year_id = p_year and ta.is_class_teacher;

  for r in select * from public.compute_report(p_section, p_year, p_term) c where p_students is null or c.student_id = any(p_students) loop
    if r.report ->> 'result' = 'no_marks' then continue; end if;
    update public.report_card set status = 'withdrawn', withdrawn_reason = 'Replaced by a newer copy'
      where student_id = r.student_id and academic_year_id = p_year and term = p_term and status = 'published';
    insert into public.report_card (school_id, academic_year_id, student_id, section_id, term, scheme_id, snapshot, published_by)
    values (v_school, p_year, r.student_id, p_section, p_term, v_scheme,
            r.report || jsonb_build_object('school', (select jsonb_build_object('name', s.name, 'place', s.place, 'board', s.affiliation_board,
                                                       'affiliation_no', s.affiliation_no, 'school_code', s.board_school_code, 'udise', s.udise_code,
                                                       'signatory', s.signatory_name, 'signatory_title', s.signatory_title)
                                                      from public.school s where s.id = v_school),
                                          'class', (select c.name || '-' || sec.name from public.section sec join public.class c on c.id = sec.class_id where sec.id = p_section),
                                          'class_teacher', v_ct,
                                          'year', (select y.name from public.academic_year y where y.id = p_year)),
            app.my_staff_id())
    returning id into v_card;
    v_n := v_n + 1;
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (v_school, 'result_published', v_card, jsonb_build_object('student_id', r.student_id, 'term', p_term, 'year', p_year));
  end loop;
  return v_n;
end $$;
grant execute on function public.publish_report_cards(bigint, bigint, smallint, bigint[]) to authenticated;

create or replace function public.verify_report_card(p_token text)
returns table (valid boolean, reason text, student_name text, class_label text, term_name text, year_name text, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select rc.status = 'published',
         case when rc.status = 'published' then 'Valid report card'
              when rc.withdrawn_reason = 'Replaced by a newer copy' then 'This copy was replaced by a newer one; ask the school for the latest'
              else 'This report card was withdrawn' end,
         rc.snapshot -> 'student' ->> 'name', rc.snapshot ->> 'class', rc.snapshot ->> 'term_name', rc.snapshot ->> 'year',
         rc.snapshot -> 'school' ->> 'name', (rc.published_at at time zone 'Asia/Kolkata')::date
  from public.report_card rc where rc.verify_token = p_token and length(p_token) between 20 and 64;
$$;
grant execute on function public.verify_report_card(text) to anon, authenticated;

create or replace function public.fan_out_result(o public.notification_outbox) returns int
language plpgsql security definer set search_path = '' as $$
declare x record; r record; v_n int := 0; v_vars jsonb;
begin
  select rc.id, rc.student_id, rc.status, rc.term, rc.academic_year_id, rc.snapshot ->> 'term_name' term_name, rc.snapshot -> 'student' ->> 'name' student,
         coalesce(nullif(s.short_name, ''), s.name) school
    into x from public.report_card rc join public.school s on s.id = rc.school_id where rc.id = o.ref_id;
  if x.id is null or x.status <> 'published' then return 0; end if;
  v_vars := jsonb_build_object('student', x.student, 'term', coalesce(x.term_name, ''), 'school', x.school);
  for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = x.student_id and gs.school_id = o.school_id loop
    if public.notify_safe(o.school_id, 'result_published', 'result:' || x.student_id || ':' || x.academic_year_id || ':' || x.term, r.guardian_id, null, x.student_id, v_vars,
         'Report card: {student}, {term}', '{school}: the {term} report card of {student} is ready. Open CampusTwin to see and download it.',
         '/dashboard/reports') is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.fan_out_result(public.notification_outbox) from public, anon, authenticated;
commit;
