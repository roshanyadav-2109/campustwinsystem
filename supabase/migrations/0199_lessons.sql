-- Lessons: what each lecture covered, so students (and parents) can trace it.
--   syllabus_unit / syllabus_topic: the syllabus of a subject (for a class in schools; the course itself in colleges)
--   lesson_log: one per lecture (section + subject + date + period): topics covered, a short note, the teacher
--   lesson_material: links and files shared with that lecture (files in private storage)
-- Seen by the subject's teachers, the office/head, the section's students (or the course's students for a course
-- taught across sections) and their families. Written only through the functions below.
begin;

create table if not exists public.syllabus_unit (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  subject_id bigint not null references public.subject(id) on delete cascade,
  class_id   bigint references public.class(id) on delete cascade,      -- null: the course's own syllabus (colleges)
  seq        int not null,
  title      text not null check (char_length(title) between 1 and 160)
);
create unique index if not exists uq_syllabus_unit on public.syllabus_unit (subject_id, coalesce(class_id, 0), seq);
create table if not exists public.syllabus_topic (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  unit_id   bigint not null references public.syllabus_unit(id) on delete cascade,
  seq       int not null,
  title     text not null check (char_length(title) between 1 and 200),
  unique (unit_id, seq)
);
create table if not exists public.lesson_log (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  section_id       bigint references public.section(id) on delete cascade,   -- null: a course taught to several sections
  subject_id       bigint not null references public.subject(id) on delete cascade,
  on_date          date not null,
  period           smallint,
  staff_id         bigint references public.staff(id) on delete set null,
  topic_ids        bigint[] not null default '{}',
  summary          text check (summary is null or char_length(summary) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_lesson_log on public.lesson_log (coalesce(section_id, 0), subject_id, on_date, coalesce(period, 0));
create index if not exists idx_lesson_log_feed on public.lesson_log (subject_id, section_id, on_date desc);
create index if not exists idx_fk_lesson_log_staff_id on public.lesson_log (staff_id) where staff_id is not null;
create table if not exists public.lesson_material (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  lesson_id  bigint not null references public.lesson_log(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 160),
  url        text check (url is null or (url ~ '^https://' and char_length(url) <= 1000)),
  file_key   text check (file_key is null or char_length(file_key) <= 400),
  created_at timestamptz not null default now(),
  check ((url is null) <> (file_key is null))
);
create index if not exists idx_lesson_material on public.lesson_material (lesson_id);
do $$ declare t text; begin
  foreach t in array array['syllabus_unit', 'syllabus_topic', 'lesson_log', 'lesson_material'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- the syllabus itself is not private: anyone at the institution may read it
drop policy if exists su_read on public.syllabus_unit;
create policy su_read on public.syllabus_unit for select to authenticated using (true);
drop policy if exists st_read on public.syllabus_topic;
create policy st_read on public.syllabus_topic for select to authenticated using (true);
grant select on public.syllabus_unit, public.syllabus_topic to authenticated;

-- teaches this subject: to this section, or (section null) the course to any section; or runs the institution
create or replace function app.can_teach_lesson(p_section bigint, p_subject bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_admin_scope(), false) or exists (
    select 1 from public.teacher_allotment a
    where a.staff_id = app.my_staff_id() and a.subject_id = p_subject and a.academic_year_id = app.current_year_id()
      and (p_section is null or a.section_id = p_section));
$$;
-- may read the lessons of a section+subject: those who teach it, or a student of it (or their family)
create or replace function app.can_see_lessons(p_section bigint, p_subject bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_teach_lesson(p_section, p_subject)
    or exists (select 1 from public.teacher_allotment a where a.staff_id = app.my_staff_id() and a.academic_year_id = app.current_year_id() and a.is_class_teacher and a.section_id = p_section)
    or exists (select 1 from public.student_enrollment e where e.status = 'active' and e.academic_year_id = app.current_year_id()
               and (app.owns_student(e.student_id)) and (e.section_id = p_section
                 or (p_section is null and exists (select 1 from public.course_roster(p_subject) r where r.student_id = e.student_id))));
$$;
grant execute on function app.can_teach_lesson(bigint, bigint) to authenticated;
grant execute on function app.can_see_lessons(bigint, bigint) to authenticated;

-- the syllabus of a subject (for a class in schools; null class for a college course): units with topics.
-- Units and topics keep their ids when their position stays, so lessons already logged keep their topics.
create or replace function public.save_syllabus(p_subject bigint, p_class bigint, p_units jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); u jsonb; t jsonb; i int := 0; j int; v_unit bigint; n int := 0;
begin
  if not exists (select 1 from public.subject where id = p_subject and school_id = v_school) then raise exception 'Unknown subject'; end if;
  if not (coalesce(app.is_admin_scope(), false) or exists (select 1 from public.teacher_allotment a join public.section s on s.id = a.section_id
            where a.staff_id = app.my_staff_id() and a.subject_id = p_subject and a.academic_year_id = app.current_year_id() and (p_class is null or s.class_id = p_class))) then
    raise exception 'Only a teacher of this subject (or the office) can change its syllabus';
  end if;
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) > 60 then raise exception 'Up to 60 units'; end if;
  for u in select * from jsonb_array_elements(p_units) loop
    i := i + 1;
    if coalesce(trim(u ->> 'title'), '') = '' then raise exception 'Each unit needs a title'; end if;
    insert into public.syllabus_unit (school_id, subject_id, class_id, seq, title) values (v_school, p_subject, p_class, i, left(trim(u ->> 'title'), 160))
    on conflict (subject_id, coalesce(class_id, 0), seq) do update set title = excluded.title returning id into v_unit;
    j := 0;
    for t in select * from jsonb_array_elements(coalesce(u -> 'topics', '[]'::jsonb)) loop
      if coalesce(trim(t #>> '{}'), '') = '' then continue; end if;
      j := j + 1; n := n + 1;
      if j > 80 then raise exception 'Up to 80 topics in a unit'; end if;
      insert into public.syllabus_topic (school_id, unit_id, seq, title) values (v_school, v_unit, j, left(trim(t #>> '{}'), 200))
      on conflict (unit_id, seq) do update set title = excluded.title;
    end loop;
    delete from public.syllabus_topic where unit_id = v_unit and seq > j;
  end loop;
  delete from public.syllabus_unit where subject_id = p_subject and class_id is not distinct from p_class and seq > i;
  return n;
end $$;
revoke all on function public.save_syllabus(bigint, bigint, jsonb) from public, anon;
grant execute on function public.save_syllabus(bigint, bigint, jsonb) to authenticated;

-- the teacher logs a lecture (again for the same lecture: it is updated)
create or replace function public.log_lesson(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_topics bigint[], p_summary text, p_links jsonb default '[]'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id bigint; l jsonb;
begin
  if not app.can_teach_lesson(p_section, p_subject) then raise exception 'Only the teacher of this subject can log its lessons'; end if;
  if p_section is not null and not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lesson is logged on or after the day it is taught'; end if;
  if coalesce(cardinality(p_topics), 0) = 0 and coalesce(trim(p_summary), '') = '' then raise exception 'Choose the topics covered or write what was taught'; end if;
  if exists (select 1 from unnest(coalesce(p_topics, '{}')) x where not exists (
               select 1 from public.syllabus_topic t join public.syllabus_unit u on u.id = t.unit_id where t.id = x and u.subject_id = p_subject)) then
    raise exception 'A topic is not in this subject''s syllabus';
  end if;
  insert into public.lesson_log (school_id, academic_year_id, section_id, subject_id, on_date, period, staff_id, topic_ids, summary)
  values (v_school, app.current_year_id(), p_section, p_subject, p_date, p_period, app.my_staff_id(), coalesce(p_topics, '{}'), left(nullif(trim(p_summary), ''), 2000))
  on conflict (coalesce(section_id, 0), subject_id, on_date, coalesce(period, 0)) do update
    set topic_ids = excluded.topic_ids, summary = excluded.summary, staff_id = excluded.staff_id, updated_at = now()
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if coalesce(l ->> 'url', '') !~ '^https://' then raise exception 'Links start with https://'; end if;
    insert into public.lesson_material (school_id, lesson_id, title, url) values (v_school, v_id, left(coalesce(nullif(trim(l ->> 'title'), ''), 'Link'), 160), left(l ->> 'url', 1000));
  end loop;
  return v_id;
end $$;
revoke all on function public.log_lesson(bigint, bigint, date, smallint, bigint[], text, jsonb) from public, anon;
grant execute on function public.log_lesson(bigint, bigint, date, smallint, bigint[], text, jsonb) to authenticated;

-- files: the teacher may upload to a lesson they can teach; the key must be in that lesson's folder
create or replace function public.lesson_upload_ok(p_lesson bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select l.school_id from public.lesson_log l where l.id = p_lesson and l.school_id = public.current_school_id() and app.can_teach_lesson(l.section_id, l.subject_id);
$$;
create or replace function public.add_lesson_file(p_lesson bigint, p_title text, p_key text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint; v_id bigint; v_dir text;
begin
  v_school := public.lesson_upload_ok(p_lesson);
  if v_school is null then raise exception 'Only the teacher of this subject can add files'; end if;
  v_dir := public.tenant_prefix(v_school) || '/lessons/' || p_lesson || '/';
  if left(coalesce(p_key, ''), length(v_dir)) <> v_dir or substr(p_key, length(v_dir) + 1) !~ '^[0-9a-f-]{36}\.(pdf|docx|pptx|xlsx|jpg|png)$' then raise exception 'Upload the file first'; end if;
  insert into public.lesson_material (school_id, lesson_id, title, file_key) values (v_school, p_lesson, left(coalesce(nullif(trim(p_title), ''), 'File'), 160), p_key) returning id into v_id;
  return v_id;
end $$;
create or replace function public.remove_lesson_material(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.lesson_material m using public.lesson_log l
  where m.id = p_id and l.id = m.lesson_id and l.school_id = public.current_school_id() and app.can_teach_lesson(l.section_id, l.subject_id);
  if not found then raise exception 'Not allowed'; end if;
end $$;
create or replace function public.lesson_material_key(p_id bigint) returns text
language sql stable security definer set search_path = '' as $$
  select m.file_key from public.lesson_material m join public.lesson_log l on l.id = m.lesson_id
  where m.id = p_id and l.school_id = public.current_school_id() and app.can_see_lessons(l.section_id, l.subject_id);
$$;
revoke all on function public.lesson_upload_ok(bigint) from public, anon;
revoke all on function public.add_lesson_file(bigint, text, text) from public, anon;
revoke all on function public.remove_lesson_material(bigint) from public, anon;
revoke all on function public.lesson_material_key(bigint) from public, anon;
grant execute on function public.lesson_upload_ok(bigint) to authenticated;
grant execute on function public.add_lesson_file(bigint, text, text) to authenticated;
grant execute on function public.remove_lesson_material(bigint) to authenticated;
grant execute on function public.lesson_material_key(bigint) to authenticated;

-- the lessons of a section+subject, newest first; for a student, their own attendance at each lecture
create or replace function public.lesson_feed(p_section bigint, p_subject bigint, p_student bigint default null)
returns table (id bigint, on_date date, period smallint, teacher text, topics jsonb, summary text, materials jsonb, attended text, course_wide boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.on_date, l.period, st.full_name,
    coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'unit', u.title) order by u.seq, t.seq)
              from public.syllabus_topic t join public.syllabus_unit u on u.id = t.unit_id where t.id = any(l.topic_ids)), '[]'::jsonb),
    l.summary,
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'url', m.url, 'file', m.file_key is not null) order by m.id) from public.lesson_material m where m.lesson_id = l.id), '[]'::jsonb),
    case when p_student is not null and app.owns_student(p_student) then
      (select ar.status::text from public.attendance_record ar where ar.student_id = p_student and ar.on_date = l.on_date and ar.subject_id = l.subject_id
         and ar.period is not distinct from l.period limit 1) end,
    l.section_id is null
  from public.lesson_log l left join public.staff st on st.id = l.staff_id
  where l.school_id = public.current_school_id() and l.subject_id = p_subject and l.academic_year_id = app.current_year_id()
    and (l.section_id = p_section or l.section_id is null)
    and (app.can_see_lessons(p_section, p_subject) or app.can_see_lessons(null, p_subject))
  order by l.on_date desc, l.period desc nulls last
  limit 300;
$$;
revoke all on function public.lesson_feed(bigint, bigint, bigint) from public, anon;
grant execute on function public.lesson_feed(bigint, bigint, bigint) to authenticated;

-- the syllabus with what has been covered for this section (or the course)
create or replace function public.syllabus_progress(p_section bigint, p_subject bigint)
returns table (unit_id bigint, unit text, unit_seq int, topic_id bigint, topic text, topic_seq int, covered_on date)
language sql stable security definer set search_path = '' as $$
  with cls as (select class_id from public.section where id = p_section),
  units as (select u.* from public.syllabus_unit u where u.subject_id = p_subject and u.school_id = public.current_school_id()
            and (u.class_id = (select class_id from cls) or (u.class_id is null and not exists (
                 select 1 from public.syllabus_unit u2 where u2.subject_id = p_subject and u2.class_id = (select class_id from cls))))),
  done as (select unnest(l.topic_ids) tid, min(l.on_date) d from public.lesson_log l
           where l.subject_id = p_subject and l.academic_year_id = app.current_year_id() and (l.section_id = p_section or l.section_id is null) group by 1)
  select u.id, u.title, u.seq, t.id, t.title, t.seq, d.d
  from units u left join public.syllabus_topic t on t.unit_id = u.id left join done d on d.tid = t.id
  where app.can_see_lessons(p_section, p_subject) or app.can_see_lessons(null, p_subject)
  order by u.seq, t.seq;
$$;
revoke all on function public.syllabus_progress(bigint, bigint) from public, anon;
grant execute on function public.syllabus_progress(bigint, bigint) to authenticated;

-- a student's subjects this year (for the student and the family), from their section's allotments
create or replace function public.lesson_subjects(p_student bigint)
returns table (section_id bigint, subject_id bigint, subject text, class_id bigint)
language sql stable security definer set search_path = '' as $$
  select distinct e.section_id, a.subject_id, sb.name, s.class_id
  from public.student_enrollment e join public.section s on s.id = e.section_id
  join public.teacher_allotment a on a.section_id = e.section_id and a.academic_year_id = e.academic_year_id and a.subject_id is not null
  join public.subject sb on sb.id = a.subject_id
  where e.student_id = p_student and e.status = 'active' and e.academic_year_id = app.current_year_id() and app.owns_student(p_student)
  order by 3;
$$;
revoke all on function public.lesson_subjects(bigint) from public, anon;
grant execute on function public.lesson_subjects(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
