-- Exam department, part 2 (colleges and universities):
--   coded answer scripts: the confidential section gives each script a code,
--   evaluators mark by code without seeing names, the confidential section
--   decodes the marks into the students' records;
--   internal (CIA) marks signed off by the Head of Department before results
--   (when the institution asks for it).
begin;
-- who works in the confidential section (or leads the exam cell)
create or replace function app.is_confidential() returns boolean
language sql stable security definer set search_path = '' as $$ select app.has_access('confidential') or app.has_access('exams_head'); $$;
grant execute on function app.is_confidential() to authenticated;

-- (exam_script is created in 0165, before the dashboard that counts it)
drop policy if exists xs_read on public.exam_script;
create policy xs_read on public.exam_script for select to authenticated using ((select app.is_confidential()));
revoke insert, update, delete on public.exam_script from authenticated;
grant select on public.exam_script to authenticated;

-- the candidates of one paper
create or replace function public.paper_candidates(p_paper bigint) returns table (student_id bigint)
language sql stable security definer set search_path = '' as $$
  select c.student_id from public.exam_paper p cross join lateral public.slot_candidates(p.session_id, p.exam_date, p.starts_at) c
  where p.id = p_paper and (
    -- a class paper: students of that class; a course paper: candidates registered for that course
    (p.class_id is not null and exists (select 1 from public.student_enrollment e join public.section sec on sec.id = e.section_id
                                        join public.exam_session s on s.id = p.session_id
                                        where e.student_id = c.student_id and sec.class_id = p.class_id and e.academic_year_id = s.academic_year_id and e.status = 'active'))
    or (p.class_id is null and exists (select 1 from public.supp_registration r join public.subject sb on sb.id = p.subject_id
                                       where r.session_id = p.session_id and r.student_id = c.student_id and r.course_id = sb.course_id)));
$$;
revoke all on function public.paper_candidates(bigint) from public, anon, authenticated;

create or replace function public.generate_scripts(p_paper bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can code answer scripts'; end if;
  if not exists (select 1 from public.exam_paper where id = p_paper and school_id = public.current_school_id()) then raise exception 'Unknown paper'; end if;
  insert into public.exam_script (school_id, paper_id, student_id, code)
  select public.current_school_id(), p_paper, c.student_id, upper(substr(md5(random()::text || clock_timestamp()::text || c.student_id::text), 1, 8))
  from public.paper_candidates(p_paper) c
  on conflict (paper_id, student_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.generate_scripts(bigint) from public, anon;
grant execute on function public.generate_scripts(bigint) to authenticated;

-- share a paper's unmarked scripts among evaluators in turn
create or replace function public.allot_evaluators(p_paper bigint, p_staff bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can allot scripts'; end if;
  if coalesce(cardinality(p_staff), 0) = 0 then raise exception 'Choose the evaluators'; end if;
  if exists (select 1 from unnest(p_staff) x where not exists (select 1 from public.staff s where s.id = x and s.school_id = public.current_school_id())) then raise exception 'Unknown staff member'; end if;
  update public.exam_script x set evaluator_id = p_staff[((y.k - 1) % cardinality(p_staff)) + 1]
  from (select id, row_number() over (order by code) k from public.exam_script where paper_id = p_paper and status = 'pending' and school_id = public.current_school_id()) y
  where x.id = y.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.allot_evaluators(bigint, bigint[]) from public, anon;
grant execute on function public.allot_evaluators(bigint, bigint[]) to authenticated;

-- an evaluator's scripts: codes only, never names
create or replace function public.my_scripts()
returns table (id bigint, code text, subject text, exam_date date, max_marks numeric, marks numeric, is_absent boolean, status text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.code, sb.name, p.exam_date, p.max_marks, x.marks, x.is_absent, x.status
  from public.exam_script x join public.exam_paper p on p.id = x.paper_id join public.subject sb on sb.id = p.subject_id
  where x.evaluator_id = app.my_staff_id() and x.school_id = public.current_school_id() and x.status <> 'decoded'
  order by p.exam_date, sb.name, x.code;
$$;
grant execute on function public.my_scripts() to authenticated;

create or replace function public.save_script_marks(p_ids bigint[], p_marks numeric[], p_absent boolean[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if cardinality(p_ids) <> cardinality(p_marks) or cardinality(p_ids) <> cardinality(p_absent) then raise exception 'Marks do not line up'; end if;
  update public.exam_script x set marks = case when y.absent then null else y.marks end, is_absent = y.absent,
    status = case when y.absent or y.marks is not null then 'marked' else 'pending' end, marked_at = now()
  from unnest(p_ids, p_marks, p_absent) as y(id, marks, absent), public.exam_paper p
  where x.id = y.id and p.id = x.paper_id and x.evaluator_id = app.my_staff_id() and x.status <> 'decoded'
    and (y.absent or y.marks is null or (y.marks >= 0 and y.marks <= p.max_marks));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.save_script_marks(bigint[], numeric[], boolean[]) from public, anon;
grant execute on function public.save_script_marks(bigint[], numeric[], boolean[]) to authenticated;

-- decode a paper: marks go into each student's marks column (class paper) or supplementary entry (course paper)
create or replace function public.decode_scripts(p_paper bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare p public.exam_paper; n int := 0;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can decode scripts'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if p.class_id is not null then
    insert into public.mark (assessment_id, student_id, marks_obtained, is_absent, school_id, entered_by)
    select a.id, x.student_id, x.marks, x.is_absent, p.school_id, app.my_staff_id()
    from public.exam_script x
    join public.exam_session s on s.id = p.session_id
    join public.student_enrollment e on e.student_id = x.student_id and e.academic_year_id = s.academic_year_id and e.status = 'active'
    join public.assessment a on a.exam_paper_id = p.id and a.section_id = e.section_id
    where x.paper_id = p.id and x.status = 'marked'
    on conflict (assessment_id, student_id) do update set marks_obtained = excluded.marks_obtained, is_absent = excluded.is_absent, entered_by = excluded.entered_by;
  else
    update public.supp_registration r set ese_marks = case when x.is_absent then null else least(x.marks / nullif(p.max_marks, 0) * r.ese_max, r.ese_max) end, is_absent = x.is_absent
    from public.exam_script x join public.subject sb on sb.id = p.subject_id
    where x.paper_id = p.id and x.status = 'marked' and r.session_id = p.session_id and r.student_id = x.student_id and r.course_id = sb.course_id and r.status = 'registered';
  end if;
  update public.exam_script set status = 'decoded', decoded_at = now() where paper_id = p.id and status = 'marked';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.decode_scripts(bigint) from public, anon;
grant execute on function public.decode_scripts(bigint) to authenticated;

-- a paper's coding progress (confidential section)
create or replace function public.script_progress(p_session bigint)
returns table (paper_id bigint, subject text, exam_date date, class_name text, scripts int, allotted int, marked int, decoded int)
language sql stable security definer set search_path = '' as $$
  select p.id, sb.name, p.exam_date, coalesce(c.name, 'By course'),
    count(x.id)::int, count(x.id) filter (where x.evaluator_id is not null)::int, count(x.id) filter (where x.status = 'marked')::int, count(x.id) filter (where x.status = 'decoded')::int
  from public.exam_paper p join public.subject sb on sb.id = p.subject_id left join public.class c on c.id = p.class_id
  left join public.exam_script x on x.paper_id = p.id
  where p.session_id = p_session and p.school_id = public.current_school_id() and app.is_confidential()
  group by p.id, sb.name, p.exam_date, c.name order by p.exam_date, sb.name;
$$;
grant execute on function public.script_progress(bigint) to authenticated;

-- ---------- internal marks signed off by the Head of Department ----------
alter table public.school add column if not exists require_cia_signoff boolean not null default false;
create table if not exists public.cia_signoff (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  semester_id bigint not null references public.semester(id) on delete cascade,
  section_id  bigint not null references public.section(id) on delete cascade,
  subject_id  bigint not null references public.subject(id) on delete cascade,
  signed_by   bigint references public.staff(id) on delete set null,
  signed_at   timestamptz not null default now(),
  unique (semester_id, section_id, subject_id)
);
alter table public.cia_signoff enable row level security;
drop policy if exists tenant_isolation on public.cia_signoff;
create policy tenant_isolation on public.cia_signoff as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists cs_read on public.cia_signoff;
create policy cs_read on public.cia_signoff for select to authenticated using ((select app.my_staff_id()) is not null);
revoke all on public.cia_signoff from anon, authenticated;
grant select on public.cia_signoff to authenticated;
grant all on public.cia_signoff to service_role;

create or replace function public.sign_cia(p_semester bigint, p_section bigint, p_subject bigint, p_undo boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_section in (select app.my_scope_sections()) or app.has_access('exams_head') or coalesce(app.is_principal(), false)) then
    raise exception 'Internal marks are signed off by the Head of Department';
  end if;
  if p_undo then
    if exists (select 1 from public.semester_result sr join public.student_enrollment e on e.student_id = sr.student_id where sr.semester_id = p_semester and e.section_id = p_section) then
      raise exception 'Results are already published for this section';
    end if;
    delete from public.cia_signoff where semester_id = p_semester and section_id = p_section and subject_id = p_subject and school_id = public.current_school_id();
  else
    insert into public.cia_signoff (semester_id, section_id, subject_id, signed_by) values (p_semester, p_section, p_subject, app.my_staff_id())
    on conflict (semester_id, section_id, subject_id) do update set signed_by = excluded.signed_by, signed_at = now();
  end if;
end $$;
revoke all on function public.sign_cia(bigint, bigint, bigint, boolean) from public, anon;
grant execute on function public.sign_cia(bigint, bigint, bigint, boolean) to authenticated;

-- what is waiting for sign-off in the caller's area: courses of the semester per section
create or replace function public.cia_signoff_status(p_semester bigint)
returns table (section_id bigint, section_label text, subject_id bigint, subject_name text, signed boolean, signed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct sec.id, c.name || '-' || sec.name, sb.id, sb.name, cs.id is not null, cs.signed_at
  from public.course_registration r join public.semester s on s.id = r.semester_id
  join public.programme_course pc on pc.id = r.programme_course_id join public.subject sb on sb.course_id = pc.course_id and sb.school_id = s.school_id
  join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = s.academic_year_id and e.status = 'active'
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  left join public.cia_signoff cs on cs.semester_id = s.id and cs.section_id = sec.id and cs.subject_id = sb.id
  where r.semester_id = p_semester and s.school_id = public.current_school_id() and r.status <> 'dropped'
    and (sec.id in (select app.my_scope_sections()) or app.is_exams() or coalesce(app.is_admin_scope(), false))
  order by 2, 4;
$$;
grant execute on function public.cia_signoff_status(bigint) to authenticated;

-- publishing waits for the sign-off when the institution asks for it
create or replace function public.check_cia_signoff(p_semester bigint, p_section bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_missing text;
begin
  if not (select require_cia_signoff from public.school where id = public.current_school_id()) then return; end if;
  select string_agg(distinct sb.name, ', ') into v_missing
  from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.semester s on s.id = r.semester_id
  join public.subject sb on sb.course_id = pc.course_id and sb.school_id = s.school_id
  join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = s.academic_year_id and e.section_id = p_section
  where r.semester_id = p_semester and r.status <> 'dropped'
    and not exists (select 1 from public.cia_signoff cs where cs.semester_id = p_semester and cs.section_id = p_section and cs.subject_id = sb.id);
  if v_missing is not null then raise exception 'Internal marks are not signed off yet for: %', left(v_missing, 200); end if;
end $$;
revoke all on function public.check_cia_signoff(bigint, bigint) from public, anon, authenticated;
commit;
notify pgrst, 'reload schema';
