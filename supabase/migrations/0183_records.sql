-- Records: transcript requests with fee and no-dues, one record across campuses, NAAC/AISHE counts by category,
-- disability, minority, intake, final-year results and teachers; dropped courses out of attendance shortage.
begin;
alter table public.staff add column if not exists gender text check (gender is null or gender in ('male', 'female', 'other')),
  add column if not exists qualification text check (qualification is null or qualification in ('phd', 'mphil', 'net', 'set', 'pg', 'ug', 'diploma', 'other')),
  add column if not exists appointment text check (appointment is null or appointment in ('permanent', 'contract', 'guest', 'visiting', 'adhoc')),
  add column if not exists joined_on date;
alter table public.programme add column if not exists intake int check (intake is null or intake between 0 and 10000);
alter table public.school add column if not exists transcript_fee numeric(10,2) check (transcript_fee is null or transcript_fee >= 0);

-- a student asks for a transcript (copies, purpose, sealed); the exam cell issues it once the fee is paid and nothing is due
create table if not exists public.transcript_request (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  copies      smallint not null default 1 check (copies between 1 and 10),
  purpose     text check (purpose is null or char_length(purpose) <= 120),
  sealed      boolean not null default false,
  status      text not null default 'requested' check (status in ('requested', 'issued', 'rejected', 'withdrawn')),
  invoice_id  bigint references public.fee_invoice(id) on delete set null,
  transcript_id bigint references public.transcript_issue(id) on delete set null,
  note        text check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table public.transcript_request enable row level security;
drop policy if exists tenant_isolation on public.transcript_request;
create policy tenant_isolation on public.transcript_request as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists tr_read on public.transcript_request;
create policy tr_read on public.transcript_request for select to authenticated using ((select app.is_exams()) or app.owns_student(student_id));
revoke all on public.transcript_request from anon, authenticated;
grant select on public.transcript_request to authenticated;
grant all on public.transcript_request to service_role;

create or replace function public.request_transcript(p_student bigint, p_copies int, p_purpose text, p_sealed boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_fee numeric; v_id bigint; v_inv bigint; v_year bigint;
begin
  if not (app.owns_student(p_student) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.course_result where student_id = p_student) then raise exception 'There are no results yet'; end if;
  if exists (select 1 from public.transcript_request where student_id = p_student and status = 'requested') then raise exception 'A transcript request is already waiting'; end if;
  insert into public.transcript_request (student_id, copies, purpose, sealed) values (p_student, greatest(least(coalesce(p_copies, 1), 10), 1), left(nullif(trim(p_purpose), ''), 120), coalesce(p_sealed, false))
  returning id into v_id;
  select transcript_fee into v_fee from public.school where id = v_school;
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  if coalesce(v_fee, 0) > 0 and v_year is not null then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, p_student, public.section_in_semester(p_student, (select id from public.semester where school_id = v_school and is_current)), v_year,
            left('Transcript fee #' || v_id, 80), v_fee * greatest(least(coalesce(p_copies, 1), 10), 1), (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.transcript_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.request_transcript(bigint, int, text, boolean) from public, anon;
grant execute on function public.request_transcript(bigint, int, text, boolean) to authenticated;

create or replace function public.decide_transcript_request(p_id bigint, p_issue boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.transcript_request; v_tok text; v_dues text;
begin
  if not app.is_exams() then raise exception 'Transcripts are issued by the exam cell'; end if;
  select * into r from public.transcript_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' then raise exception 'No waiting request'; end if;
  if not p_issue then
    update public.transcript_request set status = 'rejected', note = left(nullif(trim(p_note), ''), 200), decided_at = now() where id = r.id;
    return null;
  end if;
  -- no dues: the fee for this request and anything else owed
  select string_agg(x, '; ') into v_dues from (
    select 'the transcript fee' x where exists (select 1 from public.fee_invoice i where i.id = r.invoice_id and i.status in ('due', 'part'))
    union all select 'other fees due' where exists (select 1 from public.fee_invoice i where i.student_id = r.student_id and i.status in ('due', 'part') and i.id is distinct from r.invoice_id)
    union all select 'library books not returned' where exists (select 1 from public.library_issue l where l.student_id = r.student_id and l.returned_on is null)) d;
  if v_dues is not null then raise exception 'Not yet: %', v_dues; end if;
  v_tok := public.issue_transcript(r.student_id);
  update public.transcript_request set status = 'issued', transcript_id = (select id from public.transcript_issue where verify_token = v_tok), note = left(nullif(trim(p_note), ''), 200), decided_at = now() where id = r.id;
  perform public.notify_family(r.school_id, 'result_published', 'transcript:' || r.id, r.student_id, jsonb_build_object(), 'Transcript issued',
    'Your transcript is issued. Download it on the Results page' || case when r.sealed then ' (sealed copies from the exam cell)' else '' end || '.', '/dashboard/results');
  return v_tok;
end $$;
revoke all on function public.decide_transcript_request(bigint, boolean, text) from public, anon;
grant execute on function public.decide_transcript_request(bigint, boolean, text) to authenticated;

create or replace function public.set_transcript_fee(p_fee numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or the office) can change this'; end if;
  update public.school set transcript_fee = nullif(round(p_fee, 2), 0) where id = public.current_school_id();
end $$;
revoke all on function public.set_transcript_fee(numeric) from public, anon;
grant execute on function public.set_transcript_fee(numeric) to authenticated;

-- one record across campuses: results from an earlier campus (before a transfer) that were not carried show too;
-- staff see it only for students they may see
drop function if exists public.student_consolidated(bigint);
create function public.student_consolidated(p_student bigint)
returns table (semester_id bigint, semester_no smallint, course_code text, course_name text, credits numeric, grade text, point numeric, attempt smallint, kind text, passed boolean, campus text)
language sql stable security definer set search_path = '' as $$
  with here as (
    select l.semester_id, sr.semester_no, c.code, c.name, l.credits, l.grade, l.point, l.attempt, l.kind, l.passed, null::text campus
    from (select distinct on (cr.course_id) cr.* from public.course_result cr
          where cr.student_id = p_student and cr.school_id = public.current_school_id() and cr.counts order by cr.course_id, cr.attempt desc) l
    join public.course c on c.id = l.course_id
    left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = p_student),
  earlier as (
    select l.semester_id, sr.semester_no, c.code, c.name, l.credits, l.grade, l.point, l.attempt, l.kind, l.passed, sc.name campus
    from public.student_transfer t
    join lateral (select distinct on (cr.course_id) cr.* from public.course_result cr where cr.student_id = t.from_student and cr.counts order by cr.course_id, cr.attempt desc) l on true
    join public.course c on c.id = l.course_id join public.school sc on sc.id = t.from_school
    left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = t.from_student
    where t.to_student = p_student and not exists (select 1 from here h where h.code = c.code))
  select * from (select * from here union all select * from earlier) x
  where (app.owns_student(p_student) and public.result_hold(p_student, x.semester_id) is null) or public.staff_sees_student(p_student) or app.is_exams()
  order by x.semester_no nulls last, x.code;
$$;
revoke all on function public.student_consolidated(bigint) from public, anon;
grant execute on function public.student_consolidated(bigint) to authenticated;

create or replace function public.attendance_shortage(p_student bigint, p_semester bigint) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(x.sname || ' (' || x.pct || '%)', ', ' order by x.sname) from (
    select sb.name sname, round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1) pct
    from public.semester s join public.school sc on sc.id = s.school_id
    join public.attendance_record a on a.student_id = p_student and a.period is not null and a.subject_id is not null
      and a.on_date between s.starts_on and coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on)
    join public.subject sb on sb.id = a.subject_id
    where s.id = p_semester
    group by sb.id, sb.name, sc.attendance_minimum
    having 100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < sc.attendance_minimum
       and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = p_semester and cd.student_id = p_student and cd.subject_id = sb.id)
       -- a course the student dropped does not count
       and not exists (select 1 from public.course_registration rg join public.programme_course pc on pc.id = rg.programme_course_id
                       where rg.student_id = p_student and rg.semester_id = p_semester and pc.course_id = sb.course_id and rg.status = 'dropped')) x;
$$;

create or replace function public.statistics_for(p_school bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with yr as (select y.id from public.academic_year y where y.school_id = p_school and y.is_current),
  en as (select e.student_id, st.gender::text gender, g.id prog_id, g.name programme, g.years, g.intake, c.year_no, i.category::text category, i.special_needs, i.minority, p.state
         from public.student_enrollment e join yr on e.academic_year_id = yr.id join public.student st on st.id = e.student_id
         join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id left join public.programme g on g.id = c.programme_id
         left join public.student_identity i on i.student_id = st.id left join public.student_profile p on p.student_id = st.id
         where e.status = 'active' and e.school_id = p_school),
  stf as (select s.* from public.staff s where s.school_id = p_school and s.role in ('subject_teacher', 'class_teacher', 'principal')),
  lastsem as (select sm.id from public.semester sm where sm.school_id = p_school and exists (select 1 from public.semester_result sr where sr.semester_id = sm.id) order by sm.starts_on desc limit 1)
  select jsonb_build_object(
    'students', (select count(*) from en),
    'by_gender', coalesce((select jsonb_object_agg(coalesce(gender, 'not given'), n) from (select gender, count(*) n from en group by 1) x), '{}'),
    'by_category', coalesce((select jsonb_object_agg(coalesce(category, 'not given'), n) from (select category, count(*) n from en group by 1) x), '{}'),
    'by_minority', coalesce((select jsonb_object_agg(coalesce(minority, 'not given'), n) from (select minority, count(*) n from en group by 1) x), '{}'),
    'pwd', (select count(*) from en where special_needs),
    'by_state', coalesce((select jsonb_object_agg(coalesce(state, 'not given'), n) from (select state, count(*) n from en group by 1 order by 2 desc limit 15) x), '{}'),
    'by_programme', coalesce((select jsonb_agg(jsonb_build_object('programme', coalesce(programme, 'Other'), 'year', year_no, 'students', n, 'female', f, 'sc', sc, 'st', st, 'obc', obc, 'pwd', pwd) order by programme, year_no)
                              from (select programme, year_no, count(*) n, count(*) filter (where lower(gender) in ('f', 'female')) f, count(*) filter (where category = 'sc') sc,
                                      count(*) filter (where category = 'st') st, count(*) filter (where category = 'obc') obc, count(*) filter (where special_needs) pwd from en group by 1, 2) x), '[]'),
    'intake', coalesce((select jsonb_agg(jsonb_build_object('programme', g.name, 'intake', g.intake, 'admitted', (select count(*) from en where en.prog_id = g.id and en.year_no = 1)) order by g.name)
                        from public.programme g where g.school_id = p_school), '[]'),
    'final_year', coalesce((select jsonb_agg(jsonb_build_object('programme', x.programme, 'appeared', x.appeared, 'passed', x.passed) order by x.programme) from (
                     select en.programme, count(sr.id) appeared, count(sr.id) filter (where sr.backlogs = 0 and sr.withheld_reason is null) passed
                     from en join public.semester_result sr on sr.student_id = en.student_id and sr.semester_id = (select id from lastsem)
                     where en.year_no = en.years group by en.programme) x), '[]'),
    'staff', (select count(*) from stf),
    'staff_by_gender', coalesce((select jsonb_object_agg(coalesce(gender, 'not given'), n) from (select gender, count(*) n from stf group by 1) x), '{}'),
    'staff_by_qualification', coalesce((select jsonb_object_agg(coalesce(qualification, 'not given'), n) from (select qualification, count(*) n from stf group by 1) x), '{}'),
    'staff_by_appointment', coalesce((select jsonb_object_agg(coalesce(appointment, 'not given'), n) from (select appointment, count(*) n from stf group by 1) x), '{}'),
    'staff_by_title', coalesce((select jsonb_object_agg(t.name, n) from (select t.name, count(*) n from public.staff_position p join public.position_title t on t.id = p.title_id
                                where p.school_id = p_school and (p.ends_on is null or p.ends_on >= current_date) and t.access_type in ('faculty', 'dept_head', 'dean', 'head', 'deputy_head') group by t.name) t), '{}'),
    'pass_rates', coalesce((select jsonb_agg(jsonb_build_object('semester', m.kind || ' ' || to_char(m.starts_on, 'YYYY'), 'students', n, 'all_passed', p) order by m.starts_on)
                            from (select sr.semester_id, count(*) n, count(*) filter (where sr.backlogs = 0) p from public.semester_result sr where sr.school_id = p_school group by 1) x
                            join public.semester m on m.id = x.semester_id), '[]'),
    'programmes', (select count(*) from public.programme g where g.school_id = p_school),
    'departments', (select count(*) from public.department d where d.school_id = p_school));
$$;
revoke all on function public.statistics_for(bigint) from public, anon, authenticated;

create or replace function public.institution_statistics() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.is_exams() or coalesce(app.is_admin_scope(), false) then public.statistics_for(public.current_school_id()) end;
$$;
revoke all on function public.institution_statistics() from public, anon;
grant execute on function public.institution_statistics() to authenticated;

-- central administration: the same counts for every campus
create or replace function public.university_statistics() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.current_university_id() is not null then
    coalesce((select jsonb_agg(jsonb_build_object('campus', coalesce(nullif(s.short_name, ''), s.name), 'stats', public.statistics_for(s.id)) order by s.name)
              from public.school s where s.id in (select public.university_school_ids())), '[]') end;
$$;
revoke all on function public.university_statistics() from public, anon;
grant execute on function public.university_statistics() to authenticated;
commit;
notify pgrst, 'reload schema';
