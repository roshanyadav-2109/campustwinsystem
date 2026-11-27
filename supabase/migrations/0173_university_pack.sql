-- Step 12, university pack (central university administration):
-- the exam cell across campuses at a glance, a shared catalogue copied between
-- campuses, and inter-campus transfer that keeps grades, CGPA and one login.
begin;

create or replace function app.is_central_for(p_school bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_university_id() is not null and p_school in (select public.university_school_ids());
$$;

-- ---------- the exam cell across campuses ----------
create or replace function public.university_exam_overview()
returns table (campus_id bigint, campus text, exams_this_year int, results_published int, malpractice_open int, scripts_pending int, revaluations_open int, supplementary_waiting int)
language sql stable security definer set search_path = '' as $$
  with c as (select s.id, coalesce(nullif(s.short_name, ''), s.name) nm from public.school s where s.id in (select public.university_school_ids())),
  yr as (select y.school_id, y.id from public.academic_year y join c on c.id = y.school_id where y.is_current)
  select c.id, c.nm,
    (select count(*) from public.exam_session es join yr on yr.id = es.academic_year_id where es.school_id = c.id)::int,
    (select count(*) from public.semester_result sr join public.semester sm on sm.id = sr.semester_id join yr on yr.id = sm.academic_year_id where sr.school_id = c.id)::int,
    (select count(*) from public.exam_incident i where i.school_id = c.id and i.status = 'open')::int,
    (select count(*) from public.exam_script x where x.school_id = c.id and x.status <> 'decoded')::int,
    (select count(*) from public.reval_request r where r.school_id = c.id and r.status = 'pending')::int,
    (select count(*) from public.supp_registration r where r.school_id = c.id and r.status = 'pending')::int
  from c order by c.nm;
$$;
revoke all on function public.university_exam_overview() from public, anon;
grant execute on function public.university_exam_overview() to authenticated;

-- ---------- shared catalogue ----------
-- departments, courses and programmes the target campus lacks (matched by code) are copied from the source campus
create or replace function public.copy_catalogue(p_from bigint, p_to bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d int; c int; p int;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can copy between two of its campuses'; end if;
  insert into public.department (school_id, code, name)
  select p_to, x.code, x.name from public.department x where x.school_id = p_from
    and not exists (select 1 from public.department y where y.school_id = p_to and (y.code = x.code or y.name = x.name));
  get diagnostics d = row_count;
  insert into public.course (school_id, department_id, code, name, kind, lecture, tutorial, practical, credits)
  select p_to, (select y.id from public.department y join public.department xd on xd.id = x.department_id where y.school_id = p_to and (y.code = xd.code or y.name = xd.name) limit 1),
         x.code, x.name, x.kind, x.lecture, x.tutorial, x.practical, x.credits
  from public.course x where x.school_id = p_from and not exists (select 1 from public.course y where y.school_id = p_to and y.code = x.code);
  get diagnostics c = row_count;
  insert into public.programme (school_id, department_id, code, name, level, regulation, years, semesters, total_credits, max_credits_per_semester)
  select p_to, (select y.id from public.department y join public.department xd on xd.id = x.department_id where y.school_id = p_to and (y.code = xd.code or y.name = xd.name) limit 1),
         x.code, x.name, x.level, x.regulation, x.years, x.semesters, x.total_credits, x.max_credits_per_semester
  from public.programme x where x.school_id = p_from and not exists (select 1 from public.programme y where y.school_id = p_to and y.code = x.code);
  get diagnostics p = row_count;
  return jsonb_build_object('departments', d, 'courses', c, 'programmes', p);
end $$;
revoke all on function public.copy_catalogue(bigint, bigint) from public, anon;
grant execute on function public.copy_catalogue(bigint, bigint) to authenticated;

-- ---------- inter-campus transfer ----------
create table if not exists public.student_transfer (
  id           bigint generated always as identity primary key,
  university_id bigint not null references public.university(id) on delete cascade,
  from_school  bigint not null references public.school(id) on delete cascade,
  from_student bigint not null references public.student(id) on delete cascade,
  to_school    bigint not null references public.school(id) on delete cascade,
  to_student   bigint not null references public.student(id) on delete cascade,
  carried      int not null default 0,
  not_carried  text,
  note         text check (note is null or char_length(note) <= 300),
  done_by      uuid,
  done_at      timestamptz not null default now()
);
alter table public.student_transfer enable row level security;
drop policy if exists st_read on public.student_transfer;
create policy st_read on public.student_transfer for select to authenticated
  using (university_id = (select public.current_university_id()) or from_school = (select public.current_school_id()) or to_school = (select public.current_school_id()));
revoke all on public.student_transfer from anon, authenticated;
grant select on public.student_transfer to authenticated;
grant all on public.student_transfer to service_role;

-- sections of any campus, for central administration choosing where a student goes
create or replace function public.campus_sections(p_school bigint)
returns table (id bigint, label text)
language sql stable security definer set search_path = '' as $$
  select sec.id, c.name || '-' || sec.name from public.section sec join public.class c on c.id = sec.class_id
  where sec.school_id = p_school and app.is_central_for(p_school) order by c.name, sec.name;
$$;
grant execute on function public.campus_sections(bigint) to authenticated;

create or replace function public.transfer_student(p_from bigint, p_admission_no text, p_to bigint, p_section bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.student; v_new bigint; v_adm text; v_year bigint; v_carried int; v_missing text; v_uni bigint; g record; v_g bigint;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can transfer between two of its campuses'; end if;
  select * into s from public.student where school_id = p_from and admission_no = trim(p_admission_no);
  if s.id is null then raise exception 'No student with that admission number at this campus'; end if;
  if s.status <> 'active' then raise exception 'This student is not studying here now'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = p_to) then raise exception 'Choose a section at the new campus'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'The new campus has no current academic year'; end if;
  if exists (select 1 from public.fee_invoice i where i.student_id = s.id and i.status in ('due', 'part')) then raise exception 'Fees are due at this campus; clear or waive them first'; end if;
  if exists (select 1 from public.exam_incident i where i.student_id = s.id and i.status = 'open') then raise exception 'A malpractice report is open for this student'; end if;
  select university_id into v_uni from public.school where id = p_from;

  -- the same admission number where it is free, else marked as a transfer
  v_adm := s.admission_no;
  if exists (select 1 from public.student where school_id = p_to and admission_no = v_adm) then v_adm := left(s.admission_no, 26) || '-TR'; end if;
  insert into public.student (school_id, admission_no, full_name, dob, gender, photo_path, email, phone, status)
  values (p_to, v_adm, s.full_name, s.dob, s.gender, s.photo_path, s.email, s.phone, 'active') returning id into v_new;
  insert into public.student_enrollment (school_id, student_id, academic_year_id, section_id, status) values (p_to, v_new, v_year, p_section, 'active');

  -- parents come along, with their logins
  for g in select gu.*, gs.is_primary from public.guardian_student gs join public.guardian gu on gu.id = gs.guardian_id where gs.student_id = s.id loop
    select x.id into v_g from public.guardian x where x.school_id = p_to and x.full_name = g.full_name and coalesce(x.phone, '') = coalesce(g.phone, '') limit 1;
    if v_g is null then
      insert into public.guardian (school_id, full_name, relation, email, phone) values (p_to, g.full_name, g.relation, g.email, g.phone) returning id into v_g;
    end if;
    insert into public.guardian_student (school_id, guardian_id, student_id, is_primary) values (p_to, v_g, v_new, g.is_primary) on conflict do nothing;
    insert into public.person_membership (user_id, school_id, role, guardian_id)
    select m.user_id, p_to, 'guardian', v_g from public.person_membership m where m.guardian_id = g.id
    on conflict do nothing;
    v_g := null;
  end loop;
  -- the student's own login now opens the new campus (the old record stays readable)
  insert into public.person_membership (user_id, school_id, role, student_id)
  select m.user_id, p_to, 'student', v_new from public.person_membership m where m.student_id = s.id
  on conflict (user_id, school_id, role) do update set student_id = excluded.student_id;
  update public.profile set school_id = p_to, student_id = v_new where student_id = s.id and role::text = 'student';

  -- grades carry over where the new campus has the course (same code) and the semester (same year and kind)
  with m as (
    select cr.*, tc.id to_course, ts.id to_sem from public.course_result cr
    join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
    left join public.course tc on tc.school_id = p_to and tc.code = fc.code
    left join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name
    left join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
    where cr.student_id = s.id),
  ins as (insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed, published_at, kind, counts, grace)
          select p_to, m.to_sem, v_new, m.to_course, m.attempt, m.credits, m.cia, m.cia_max, m.ese, m.ese_max, m.percent, m.grade, m.point, m.passed, m.published_at, m.kind, m.counts, m.grace
          from m where m.to_course is not null and m.to_sem is not null returning 1)
  select (select count(*) from ins), (select string_agg(distinct fc.code, ', ') from m join public.course fc on fc.id = m.course_id where m.to_course is null or m.to_sem is null)
    into v_carried, v_missing;
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_at, withheld_reason, published_as)
  select p_to, ts.id, v_new, sr.semester_no, sr.credits_registered, sr.credits_earned, sr.sgpa, sr.cgpa, sr.backlogs, sr.published_at, sr.withheld_reason, coalesce(sr.published_as, '') || ' (transferred)'
  from public.semester_result sr join public.semester fs on fs.id = sr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
  where sr.student_id = s.id
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_cgpa(array[v_new]);

  -- the old record is closed
  update public.student set status = 'transferred', left_on = current_date, exit_remark = left('Transferred to ' || (select name from public.school where id = p_to), 200) where id = s.id;
  update public.student_enrollment set status = 'transferred' where student_id = s.id and status = 'active';
  insert into public.student_transfer (university_id, from_school, from_student, to_school, to_student, carried, not_carried, note, done_by)
  values (v_uni, p_from, s.id, p_to, v_new, v_carried, v_missing, left(nullif(trim(coalesce(p_note, '')), ''), 300), auth.uid());
  return jsonb_build_object('student_id', v_new, 'admission_no', v_adm, 'carried', v_carried, 'not_carried', v_missing);
end $$;
revoke all on function public.transfer_student(bigint, text, bigint, bigint, text) from public, anon;
grant execute on function public.transfer_student(bigint, text, bigint, bigint, text) to authenticated;
commit;
notify pgrst, 'reload schema';
