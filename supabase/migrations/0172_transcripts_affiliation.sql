-- Steps 11 and 12 (colleges and universities): transcripts with a QR check;
-- the affiliated-college pack (affiliating university and college code,
-- internal marks export, importing the university's results, and the counts
-- NAAC and AISHE returns ask for).
begin;
-- ---------- transcripts ----------
create table if not exists public.transcript_issue (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  verify_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  cgpa         numeric(4,2),
  credits      numeric(6,1),
  issued_by    bigint references public.staff(id) on delete set null,
  issued_at    timestamptz not null default now(),
  revoked_at   timestamptz
);
alter table public.transcript_issue enable row level security;
drop policy if exists tenant_isolation on public.transcript_issue;
create policy tenant_isolation on public.transcript_issue as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists ti_read on public.transcript_issue;
create policy ti_read on public.transcript_issue for select to authenticated using ((select app.is_exams()) or app.owns_student(student_id));
revoke all on public.transcript_issue from anon, authenticated;
grant select on public.transcript_issue to authenticated;
grant all on public.transcript_issue to service_role;

-- the exam cell issues a transcript (the record of the standing at that moment, with a QR token)
create or replace function public.issue_transcript(p_student bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tok text; st record;
begin
  if not app.is_exams() then raise exception 'Transcripts are issued by the exam cell'; end if;
  if not exists (select 1 from public.student where id = p_student and school_id = public.current_school_id()) then raise exception 'Unknown student'; end if;
  if exists (select 1 from public.exam_incident i where i.student_id = p_student and i.status = 'open') then raise exception 'A malpractice report is open for this student'; end if;
  select * into st from public.student_standing(p_student);
  insert into public.transcript_issue (student_id, cgpa, credits, issued_by) values (p_student, st.cgpa, st.credits_earned, app.my_staff_id()) returning verify_token into v_tok;
  return v_tok;
end $$;
revoke all on function public.issue_transcript(bigint) from public, anon;
grant execute on function public.issue_transcript(bigint) to authenticated;

create or replace function public.revoke_transcript(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or the office) can withdraw a transcript'; end if;
  update public.transcript_issue set revoked_at = now() where id = p_id and school_id = public.current_school_id() and revoked_at is null;
  if not found then raise exception 'Already withdrawn'; end if;
end $$;
revoke all on function public.revoke_transcript(bigint) from public, anon;
grant execute on function public.revoke_transcript(bigint) to authenticated;

create or replace function public.verify_transcript(p_token text)
returns table (valid boolean, student_name text, programme text, cgpa numeric, credits numeric, school_name text, issued_on date)
language sql stable security definer set search_path = '' as $$
  select t.revoked_at is null and st.status <> 'left', st.full_name,
    (select g.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
       join public.programme g on g.id = c.programme_id where e.student_id = st.id order by (e.status = 'active') desc, e.academic_year_id desc limit 1),
    t.cgpa, t.credits, sc.name, (t.issued_at at time zone 'Asia/Kolkata')::date
  from public.transcript_issue t join public.student st on st.id = t.student_id join public.school sc on sc.id = t.school_id
  where t.verify_token = p_token and length(p_token) between 20 and 64;
$$;
revoke all on function public.verify_transcript(text) from public;
grant execute on function public.verify_transcript(text) to anon, authenticated;

-- ---------- affiliated colleges (affiliating university and college code are already on the institution profile) ----------
alter table public.school drop column if exists affiliating_university, drop column if exists college_code;
drop function if exists public.set_affiliation(text, text);

-- the university's results, imported by the exam cell (affiliated colleges whose university conducts the exams):
-- rows of admission number, course code, grade, grade point and whether passed; first attempts of the semester
create or replace function public.import_university_results(p_semester bigint, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_ids bigint[]; n int; v_bad text;
begin
  if not app.can_publish_results() then raise exception 'Results are imported by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  with r as (select * from jsonb_to_recordset(p_rows) as x(admission_no text, course_code text, grade text, point numeric, passed boolean)),
  m as (select r.*, st.id student_id, c.id course_id, c.credits from r
        left join public.student st on st.admission_no = trim(r.admission_no) and st.school_id = v_school
        left join public.course c on c.code = trim(r.course_code) and c.school_id = v_school)
  select string_agg(distinct coalesce(m.admission_no, '?') || '/' || coalesce(m.course_code, '?'), ', ') into v_bad from m where m.student_id is null or m.course_id is null or m.grade is null;
  if v_bad is not null then raise exception 'These rows do not match a student and a course: %', left(v_bad, 300); end if;
  with r as (select * from jsonb_to_recordset(p_rows) as x(admission_no text, course_code text, grade text, point numeric, passed boolean)),
  m as (select st.id student_id, c.id course_id, c.credits, trim(r.grade) grade, coalesce(r.point, 0) point, coalesce(r.passed, coalesce(r.point, 0) > 0) passed from r
        join public.student st on st.admission_no = trim(r.admission_no) and st.school_id = v_school
        join public.course c on c.code = trim(r.course_code) and c.school_id = v_school),
  del as (delete from public.course_result d using m where d.semester_id = p_semester and d.student_id = m.student_id and d.course_id = m.course_id and d.attempt = 1 returning 1),
  ins as (insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed)
          select v_school, p_semester, m.student_id, m.course_id, 1, m.credits, m.grade, case when m.passed then m.point else 0 end, m.passed from m
          where (select count(*) from del) >= 0
          returning student_id)
  select coalesce(array_agg(distinct student_id), '{}'), count(*) into v_ids, n from ins;
  -- each student's semester line and CGPA
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, backlogs, published_by, published_as)
  select v_school, p_semester, x, 0, 0, null, 0, app.my_staff_id(), 'Imported from the university' from unnest(v_ids) x
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_semester_line(x, p_semester) from unnest(v_ids) x;
  perform public.refresh_cgpa(v_ids);
  return n;
end $$;
revoke all on function public.import_university_results(bigint, jsonb) from public, anon;
grant execute on function public.import_university_results(bigint, jsonb) to authenticated;

-- the counts NAAC and AISHE returns ask for
create or replace function public.institution_statistics() returns jsonb
language sql stable security definer set search_path = '' as $$
  with sc as (select public.current_school_id() id), yr as (select y.id from public.academic_year y, sc where y.school_id = sc.id and y.is_current),
  en as (select e.student_id, st.gender::text gender, g.name programme, c.year_no
         from public.student_enrollment e join yr on e.academic_year_id = yr.id join public.student st on st.id = e.student_id
         join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id left join public.programme g on g.id = c.programme_id
         where e.status = 'active')
  select case when app.is_exams() or coalesce(app.is_admin_scope(), false) then jsonb_build_object(
    'students', (select count(*) from en),
    'by_gender', coalesce((select jsonb_object_agg(coalesce(gender, 'not given'), n) from (select gender, count(*) n from en group by 1) x), '{}'),
    'by_programme', coalesce((select jsonb_agg(jsonb_build_object('programme', coalesce(programme, 'Other'), 'year', year_no, 'students', n, 'female', f) order by programme, year_no)
                              from (select programme, year_no, count(*) n, count(*) filter (where lower(gender) in ('f', 'female')) f from en group by 1, 2) x), '[]'),
    'staff', (select count(*) from public.staff s, sc where s.school_id = sc.id and s.role in ('subject_teacher', 'class_teacher', 'principal')),
    'staff_by_title', coalesce((select jsonb_object_agg(t.name, n) from (select t.name, count(*) n from public.staff_position p join public.position_title t on t.id = p.title_id, sc
                                where p.school_id = sc.id and (p.ends_on is null or p.ends_on >= current_date) and t.access_type in ('faculty', 'dept_head', 'dean', 'head', 'deputy_head') group by t.name) t), '{}'),
    'pass_rates', coalesce((select jsonb_agg(jsonb_build_object('semester', m.kind || ' ' || to_char(m.starts_on, 'YYYY'), 'students', n, 'all_passed', p) order by m.starts_on)
                            from (select sr.semester_id, count(*) n, count(*) filter (where sr.backlogs = 0) p from public.semester_result sr, sc where sr.school_id = sc.id group by 1) x
                            join public.semester m on m.id = x.semester_id), '[]'),
    'programmes', (select count(*) from public.programme g, sc where g.school_id = sc.id),
    'departments', (select count(*) from public.department d, sc where d.school_id = sc.id)) end;
$$;
revoke all on function public.institution_statistics() from public, anon;
grant execute on function public.institution_statistics() to authenticated;
commit;
notify pgrst, 'reload schema';
