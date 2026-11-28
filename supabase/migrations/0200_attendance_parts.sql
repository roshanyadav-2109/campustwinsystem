-- Attendance, part 1:
--   * colleges: a subject's parts (theory, practical, tutorial; some subjects practical only), teachers per part and
--     per batch, attendance per part, and a per-part breakdown beside the compiled figure (course_attendance unchanged)
--   * batches within a section (e.g. lab batches B1, B2); marking a batch never touches the other batch
--   * changing attendance already submitted needs a reason (kept in the change log)
--   * students (or families) ask for a correction of a lecture marked absent; the teacher accepts or declines
--   * leave can be medical, with a certificate; approved leave turns those absences into "leave"
-- Additive: old screens keep working (null part = the whole subject / theory, as before).
begin;

-- ---------- parts and batches ----------
alter table public.subject add column if not exists components text[] not null default '{theory}';
alter table public.subject drop constraint if exists subject_components_check;
alter table public.subject add constraint subject_components_check check (cardinality(components) between 1 and 3 and components <@ array['theory', 'practical', 'tutorial']);
alter table public.teacher_allotment add column if not exists component text check (component in ('theory', 'practical', 'tutorial'));
alter table public.teacher_allotment add column if not exists batch text check (batch is null or batch ~ '^[A-Za-z0-9 -]{1,20}$');
alter table public.teacher_allotment drop constraint if exists teacher_allotment_staff_id_section_id_subject_id_academic_y_key;
create unique index if not exists uq_teacher_allotment on public.teacher_allotment (staff_id, section_id, subject_id, academic_year_id, coalesce(component, ''), coalesce(batch, ''));
alter table public.attendance_record add column if not exists component text check (component in ('theory', 'practical', 'tutorial'));
alter table public.attendance_change_log add column if not exists component text, add column if not exists reason text check (reason is null or char_length(reason) <= 300);
alter table public.lesson_log add column if not exists component text check (component in ('theory', 'practical', 'tutorial'));
drop index if exists public.uq_lesson_log;
create unique index if not exists uq_lesson_log on public.lesson_log (coalesce(section_id, 0), subject_id, on_date, coalesce(period, 0), coalesce(component, ''));

create table if not exists public.section_batch_member (
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  section_id bigint not null references public.section(id) on delete cascade,
  label      text not null check (label ~ '^[A-Za-z0-9 -]{1,20}$'),
  student_id bigint not null references public.student(id) on delete cascade,
  primary key (section_id, student_id)
);
alter table public.section_batch_member enable row level security;
drop policy if exists tenant_isolation on public.section_batch_member;
create policy tenant_isolation on public.section_batch_member as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists sbm_read on public.section_batch_member;
create policy sbm_read on public.section_batch_member for select to authenticated using (true);
revoke all on public.section_batch_member from anon, authenticated;
grant select on public.section_batch_member to authenticated;
grant all on public.section_batch_member to service_role;

-- the office (or the section's class teacher) sets a section's batches: [{"label": "B1", "students": [..]}, ...]
create or replace function public.save_section_batches(p_section bigint, p_batches jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); b jsonb; n int := 0;
begin
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, app.current_year_id())) then raise exception 'Only the office or the class teacher can set batches'; end if;
  delete from public.section_batch_member where section_id = p_section;
  for b in select * from jsonb_array_elements(coalesce(p_batches, '[]'::jsonb)) loop
    insert into public.section_batch_member (school_id, section_id, label, student_id)
    select v_school, p_section, trim(b ->> 'label'), x::bigint from jsonb_array_elements_text(coalesce(b -> 'students', '[]'::jsonb)) x
    where exists (select 1 from public.student_enrollment e where e.student_id = x::bigint and e.section_id = p_section and e.status = 'active' and e.academic_year_id = app.current_year_id())
    on conflict (section_id, student_id) do update set label = excluded.label;
    get diagnostics n = row_count;
  end loop;
  return (select count(*) from public.section_batch_member where section_id = p_section);
end $$;
revoke all on function public.save_section_batches(bigint, jsonb) from public, anon;
grant execute on function public.save_section_batches(bigint, jsonb) to authenticated;

create or replace function public.set_subject_components(p_subject bigint, p_components text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office can change a subject''s parts'; end if;
  update public.subject set components = p_components where id = p_subject and school_id = public.current_school_id();
  if not found then raise exception 'Unknown subject'; end if;
end $$;
revoke all on function public.set_subject_components(bigint, text[]) from public, anon;
grant execute on function public.set_subject_components(bigint, text[]) to authenticated;

-- approved leave (incl. medical) covering a day turns an absence that day into "leave"
create or replace function app.on_leave(p_student bigint, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_application l where l.student_id = p_student and l.status = 'approved' and p_day between l.from_date and l.to_date);
$$;

-- ---------- marking a lecture: one part, one batch; a change needs a reason ----------
drop function if exists public.mark_lecture(bigint, bigint, date, smallint, bigint[]);
create function public.mark_lecture(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_absent bigint[],
                                    p_component text default null, p_batch text default null, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_lock text; v_old bigint[]; v_had boolean; v_parts text[]; v_comp text := p_component; v_roster bigint[]; v_new bigint[];
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section or subject'; end if;
  select components into v_parts from public.subject where id = p_subject and school_id = v_school;
  if v_parts is null then raise exception 'Unknown section or subject'; end if;
  if v_comp is null and v_parts = '{practical}' then v_comp := 'practical'; end if;
  if v_comp is not null and not (v_comp = any(v_parts)) then raise exception 'This subject has no % part', v_comp; end if;
  if not (coalesce(app.is_office(), false) or app.ct_of_section(p_section, v_year)
          or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = v_year
                     and (ta.component is null or ta.component = coalesce(v_comp, 'theory')) and (ta.batch is null or ta.batch = p_batch))) then
    raise exception 'Only the teacher of this course (this part and batch) can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  v_lock := public.lecture_lock_reason(p_section, p_subject, p_date);
  if v_lock is not null then raise exception '%', v_lock; end if;
  -- the roster being marked: the section (registered students for an elective), or one batch of it
  select coalesce(array_agg(e.student_id), '{}') into v_roster
  from public.student_enrollment e where e.section_id = p_section and e.academic_year_id = v_year and e.status = 'active'
    and (not public.subject_is_elective(p_subject)
         or exists (select 1 from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.subject sb on sb.id = p_subject and sb.course_id = pc.course_id
                    join public.semester s on s.id = r.semester_id and s.is_current where r.student_id = e.student_id and r.status <> 'dropped'))
    and (p_batch is null or exists (select 1 from public.section_batch_member m where m.section_id = p_section and m.student_id = e.student_id and m.label = p_batch));
  if cardinality(v_roster) = 0 then raise exception 'No students to mark%', case when p_batch is not null then ' in batch ' || p_batch else '' end; end if;
  select coalesce(array_agg(x order by x), '{}') into v_new from unnest(coalesce(p_absent, '{}')) x where x = any(v_roster);
  select count(*) > 0, coalesce(array_agg(a.student_id order by a.student_id) filter (where a.status = 'absent'), '{}') into v_had, v_old
    from public.attendance_record a
   where a.student_id = any(v_roster) and a.section_id = p_section and a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
  if v_had and v_old is distinct from v_new then
    if nullif(trim(p_reason), '') is null then raise exception 'This lecture was already marked. Give a reason for the change'; end if;
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, component, reason)
    values (v_school, p_section, p_subject, p_date, p_period, app.my_staff_id(), v_old, v_new, v_comp, left(trim(p_reason), 300));
  end if;
  delete from public.attendance_record a
   where a.student_id = any(v_roster) and a.section_id = p_section and a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id, component)
  select r, p_section, v_year, p_date, p_period, p_subject,
         (case when r = any(v_new) and not app.on_duty(r, p_date) then (case when app.on_leave(r, p_date) then 'leave' else 'absent' end) else 'present' end)::public.attendance_status,
         app.my_staff_id(), v_school, v_comp
  from unnest(v_roster) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_lecture(bigint, bigint, date, smallint, bigint[], text, text, text) from public, anon;
grant execute on function public.mark_lecture(bigint, bigint, date, smallint, bigint[], text, text, text) to authenticated;

drop function if exists public.mark_course_lecture(bigint, date, smallint, bigint[]);
create function public.mark_course_lecture(p_subject bigint, p_date date, p_period smallint, p_absent bigint[], p_component text default null, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_sec record; v_lock text; v_busy text; v_old bigint[]; v_had boolean; v_roster jsonb; v_parts text[]; v_comp text := p_component;
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  select components into v_parts from public.subject where id = p_subject and school_id = v_school;
  if v_parts is null then raise exception 'Unknown course'; end if;
  if v_comp is null and v_parts = '{practical}' then v_comp := 'practical'; end if;
  if v_comp is not null and not (v_comp = any(v_parts)) then raise exception 'This subject has no % part', v_comp; end if;
  if not exists (select 1 from public.teacher_allotment ta where ta.subject_id = p_subject and ta.academic_year_id = v_year
                 and (coalesce(app.is_office(), false) or (ta.staff_id = app.my_staff_id() and (ta.component is null or ta.component = coalesce(v_comp, 'theory'))))) then
    raise exception 'Only the teacher of this course can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('student_id', r.student_id, 'student_name', r.student_name, 'section_id', r.section_id, 'section_label', r.section_label)), '[]'::jsonb)
    into v_roster from public.course_roster(p_subject) r;
  for v_sec in select distinct rn.section_id, rn.section_label from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) loop
    v_lock := public.lecture_lock_reason(v_sec.section_id, p_subject, p_date);
    if v_lock is not null then raise exception '% (%)', v_lock, v_sec.section_label; end if;
  end loop;
  select string_agg(distinct rn.student_name, ', ') into v_busy from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text)
    join public.attendance_record a on a.student_id = rn.student_id and a.on_date = p_date and a.period = p_period and a.subject_id is distinct from p_subject;
  if v_busy is not null then raise exception 'Period % on that day is already marked for another course for: %', p_period, left(v_busy, 200); end if;
  for v_sec in select distinct rn.section_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) loop
    select count(*) > 0, coalesce(array_agg(a.student_id order by a.student_id) filter (where a.status = 'absent'), '{}') into v_had, v_old
      from public.attendance_record a join jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) on rn.student_id = a.student_id and rn.section_id = v_sec.section_id
     where a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
    if v_had and nullif(trim(p_reason), '') is null and v_old is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_absent, '{}')) x
                                         where x in (select rn.student_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) where rn.section_id = v_sec.section_id)) then
      raise exception 'This lecture was already marked. Give a reason for the change';
    end if;
    if v_had and v_old is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_absent, '{}')) x
                                         where x in (select rn.student_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) where rn.section_id = v_sec.section_id)) then
      insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, component, reason)
      select v_school, v_sec.section_id, p_subject, p_date, p_period, app.my_staff_id(), v_old,
             coalesce((select array_agg(x order by x) from unnest(coalesce(p_absent, '{}')) x where x in (select rn.student_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) where rn.section_id = v_sec.section_id)), '{}'), v_comp, left(trim(p_reason), 300);
    end if;
  end loop;
  delete from public.attendance_record a using jsonb_to_recordset(v_roster) as r(student_id bigint, student_name text, section_id bigint, section_label text)
   where a.student_id = r.student_id and a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id, component)
  select r.student_id, r.section_id, v_year, p_date, p_period, p_subject,
         (case when r.student_id = any(coalesce(p_absent, '{}')) and not app.on_duty(r.student_id, p_date) then (case when app.on_leave(r.student_id, p_date) then 'leave' else 'absent' end) else 'present' end)::public.attendance_status, app.my_staff_id(), v_school, v_comp
  from jsonb_to_recordset(v_roster) as r(student_id bigint, student_name text, section_id bigint, section_label text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_course_lecture(bigint, date, smallint, bigint[], text, text) from public, anon;
grant execute on function public.mark_course_lecture(bigint, date, smallint, bigint[], text, text) to authenticated;

-- attendance per part (theory / practical / tutorial); the compiled figure per subject stays course_attendance
create or replace function public.course_attendance_parts(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, subject_id bigint, component text, held int, attended int, percent numeric, short boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric; v_end date; v_mine_only boolean := false;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
  elsif p_section is null and exists (select 1 from app.my_positions_now() p join public.position_title t on t.id = p.title_id where t.access_type in ('dean', 'dept_head', 'programme_coord')) then
    v_mine_only := not coalesce(app.is_admin_scope(), false); -- Deans, HoDs and coordinators see the summary of their own area (owner)
  elsif p_section is null or not (coalesce(app.is_admin_scope(), false) or coalesce(p_section in (select app.my_scope_sections()), false) or coalesce(app.ct_of_section(p_section, s.academic_year_id), false) or coalesce(app.teaches_section(p_section, s.academic_year_id), false)) then
    raise exception 'Not allowed';
  end if;
  select attendance_minimum, coalesce(case when attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on) into v_min, v_end from public.school where id = v_school;
  return query
  select a.student_id, a.subject_id, coalesce(a.component, case when sb.components = '{practical}' then 'practical' else 'theory' end),
    count(*)::int, count(*) filter (where a.status in ('present', 'late'))::int,
    round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1),
    100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min
  from public.attendance_record a join public.subject sb on sb.id = a.subject_id
  where a.school_id = v_school and a.period is not null and a.subject_id is not null
    and a.on_date between s.starts_on and v_end
    and (p_section is null or a.section_id = p_section) and (p_student is null or a.student_id = p_student)
    and (not v_mine_only or a.student_id in (select app.my_dept_students()))
  group by a.student_id, a.subject_id, 3
  order by 1, 2, 3;
end $$;
revoke all on function public.course_attendance_parts(bigint, bigint) from public, anon;
grant execute on function public.course_attendance_parts(bigint, bigint) to authenticated;

-- ---------- the student asks: "I was present" ----------
create table if not exists public.attendance_correction (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  section_id  bigint not null references public.section(id) on delete cascade,
  subject_id  bigint references public.subject(id) on delete cascade,
  on_date     date not null,
  period      smallint,
  reason      text not null check (char_length(reason) between 3 and 500),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requested_by uuid,
  decided_by  bigint references public.staff(id) on delete set null,
  decided_at  timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_attendance_correction_open on public.attendance_correction (student_id, on_date, coalesce(period, 0), coalesce(subject_id, 0)) where status = 'pending';
create index if not exists idx_fk_attendance_correction_decided_by on public.attendance_correction (decided_by) where decided_by is not null;
alter table public.attendance_correction enable row level security;
drop policy if exists tenant_isolation on public.attendance_correction;
create policy tenant_isolation on public.attendance_correction as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists ac_read on public.attendance_correction;
create policy ac_read on public.attendance_correction for select to authenticated using (
  app.owns_student(student_id) or (select app.is_admin_scope()) or app.ct_of_section(section_id, app.current_year_id())
  or exists (select 1 from public.teacher_allotment ta where ta.staff_id = (select app.my_staff_id()) and ta.section_id = attendance_correction.section_id and ta.subject_id = attendance_correction.subject_id and ta.academic_year_id = app.current_year_id()));
revoke all on public.attendance_correction from anon, authenticated;
grant select on public.attendance_correction to authenticated;
grant all on public.attendance_correction to service_role;

create or replace function public.request_attendance_correction(p_student bigint, p_date date, p_period smallint, p_subject bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare a public.attendance_record; v_id bigint; v_teacher bigint;
begin
  if not app.owns_student(p_student) then raise exception 'Not allowed'; end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then raise exception 'Say what happened (for example: I was in the class and answered the roll)'; end if;
  select * into a from public.attendance_record where student_id = p_student and on_date = p_date and period is not distinct from p_period
    and subject_id is not distinct from p_subject and school_id = public.current_school_id();
  if a.id is null then raise exception 'No attendance is marked for that lecture'; end if;
  if a.status <> 'absent' then raise exception 'That lecture is not marked absent'; end if;
  if p_date < (now() at time zone 'Asia/Kolkata')::date - 15 then raise exception 'Corrections can be asked within 15 days of the lecture'; end if;
  insert into public.attendance_correction (school_id, student_id, section_id, subject_id, on_date, period, reason, requested_by)
  values (a.school_id, p_student, a.section_id, p_subject, p_date, p_period, left(trim(p_reason), 500), auth.uid()) returning id into v_id;
  -- the teacher who marked it is told
  v_teacher := a.marked_by;
  if v_teacher is not null then
    perform public.notify_safe(a.school_id, 'announcement', 'att-corr:' || v_id, null, v_teacher, null,
      jsonb_build_object('who', (select full_name from public.student where id = p_student), 'day', to_char(p_date, 'DD Mon')),
      'Attendance correction asked', '{who} says they were present on {day}. See Attendance corrections.', '/dashboard/lectures?view=corrections');
  end if;
  return v_id;
exception when unique_violation then raise exception 'A correction for that lecture is already waiting';
end $$;
revoke all on function public.request_attendance_correction(bigint, date, smallint, bigint, text) from public, anon;
grant execute on function public.request_attendance_correction(bigint, date, smallint, bigint, text) to authenticated;

-- the teacher of that subject (the class teacher for a day's attendance, or the office) decides
create or replace function public.decide_attendance_correction(p_id bigint, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.attendance_correction;
begin
  select * into c from public.attendance_correction where id = p_id and school_id = public.current_school_id() and status = 'pending' for update;
  if c.id is null then raise exception 'No waiting correction'; end if;
  if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(c.section_id, app.current_year_id())
          or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = c.section_id and ta.subject_id = c.subject_id and ta.academic_year_id = app.current_year_id())) then
    raise exception 'Only the teacher of this subject can decide';
  end if;
  if not p_accept and nullif(trim(p_note), '') is null then raise exception 'Say why it is declined'; end if;
  update public.attendance_correction set status = case when p_accept then 'accepted' else 'declined' end, decided_by = app.my_staff_id(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300) where id = c.id;
  if p_accept then
    update public.attendance_record set status = 'present', marked_by = app.my_staff_id()
     where student_id = c.student_id and on_date = c.on_date and period is not distinct from c.period and subject_id is not distinct from c.subject_id and status = 'absent';
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, reason)
    values (c.school_id, c.section_id, c.subject_id, c.on_date, c.period, app.my_staff_id(), array[c.student_id], '{}', left('Correction asked by the student: ' || c.reason, 300));
  end if;
  perform public.notify_family(c.school_id, 'announcement', 'att-corr-done:' || c.id, c.student_id,
    jsonb_build_object('day', to_char(c.on_date, 'DD Mon')), case when p_accept then 'Attendance corrected' else 'Attendance correction declined' end,
    case when p_accept then 'The lecture on {day} is now marked present.' else 'The request for {day} was declined: ' || coalesce(p_note, '') end, '/dashboard/lectures');
end $$;
revoke all on function public.decide_attendance_correction(bigint, boolean, text) from public, anon;
grant execute on function public.decide_attendance_correction(bigint, boolean, text) to authenticated;

-- ---------- medical leave with a certificate ----------
alter table public.leave_application add column if not exists kind text not null default 'leave' check (kind in ('leave', 'medical'));
alter table public.leave_application add column if not exists file_key text check (file_key is null or char_length(file_key) <= 400);

-- the student (colleges) or the family applies; a medical certificate is uploaded into the student's own folder
create or replace function public.apply_student_leave(p_student bigint, p_from date, p_to date, p_reason text, p_kind text default 'leave', p_file_key text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_sec bigint; v_id bigint; v_dir text;
begin
  if not app.owns_student(p_student) then raise exception 'Not allowed'; end if;
  if p_kind not in ('leave', 'medical') then raise exception 'Unknown kind of leave'; end if;
  if p_to < p_from or p_to - p_from > 60 then raise exception 'Check the dates (up to 60 days)'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason'; end if;
  if p_kind = 'medical' and p_file_key is null then raise exception 'Attach the medical certificate'; end if;
  if p_file_key is not null then
    v_dir := public.tenant_prefix(public.current_school_id()) || '/students/' || p_student || '/medical/';
    if left(p_file_key, length(v_dir)) <> v_dir or substr(p_file_key, length(v_dir) + 1) !~ '^[0-9a-f-]{36}\.(pdf|jpg|png)$' then raise exception 'Upload the certificate first'; end if;
  end if;
  select section_id into v_sec from public.student_enrollment where student_id = p_student and academic_year_id = app.current_year_id() and status = 'active' limit 1;
  if v_sec is null then raise exception 'Not enrolled this year'; end if;
  insert into public.leave_application (school_id, student_id, section_id, academic_year_id, applied_by, from_date, to_date, reason, status, kind, file_key)
  values (public.current_school_id(), p_student, v_sec, app.current_year_id(), auth.uid(), p_from, p_to, left(trim(p_reason), 500), 'pending', p_kind, p_file_key) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.apply_student_leave(bigint, date, date, text, text, text) from public, anon;
grant execute on function public.apply_student_leave(bigint, date, date, text, text, text) to authenticated;

-- the certificate is opened by those who may decide the leave, and by the family
create or replace function public.leave_file_key(p_leave bigint) returns text
language sql stable security definer set search_path = '' as $$
  select l.file_key from public.leave_application l where l.id = p_leave and l.school_id = public.current_school_id()
    and (app.owns_student(l.student_id) or coalesce(app.is_admin_scope(), false) or app.ct_of_section(l.section_id, l.academic_year_id));
$$;
revoke all on function public.leave_file_key(bigint) from public, anon;
grant execute on function public.leave_file_key(bigint) to authenticated;

-- approved leave turns those days' absences into "leave" (logged)
create or replace function public.leave_to_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, reason)
    select a.school_id, a.section_id, a.subject_id, a.on_date, a.period, new.decided_by, array[a.student_id], '{}', left((case when new.kind = 'medical' then 'Medical leave approved' else 'Leave approved' end), 300)
    from public.attendance_record a where a.student_id = new.student_id and a.on_date between new.from_date and new.to_date and a.status = 'absent';
    update public.attendance_record set status = 'leave' where student_id = new.student_id and on_date between new.from_date and new.to_date and status = 'absent';
  end if;
  return new;
end $$;
drop trigger if exists trg_leave_to_attendance on public.leave_application;
create trigger trg_leave_to_attendance after update of status on public.leave_application for each row execute function public.leave_to_attendance();
commit;
notify pgrst, 'reload schema';

-- on duty (events, sports, competitions) with proof; medical and on duty are for colleges and universities
begin;
alter table public.leave_application drop constraint if exists leave_application_kind_check;
alter table public.leave_application add constraint leave_application_kind_check check (kind in ('leave', 'medical', 'on_duty'));

create or replace function public.apply_student_leave(p_student bigint, p_from date, p_to date, p_reason text, p_kind text default 'leave', p_file_key text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_sec bigint; v_id bigint; v_dir text;
begin
  if not app.owns_student(p_student) then raise exception 'Not allowed'; end if;
  if p_kind not in ('leave', 'medical', 'on_duty') then raise exception 'Unknown kind of leave'; end if;
  if p_kind in ('medical', 'on_duty') and not public.is_higher_ed(public.current_school_id()) then raise exception 'Medical and on-duty requests are for colleges and universities'; end if;
  if p_to < p_from or p_to - p_from > 60 then raise exception 'Check the dates (up to 60 days)'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason'; end if;
  if p_kind = 'medical' and p_file_key is null then raise exception 'Attach the medical certificate'; end if;
  if p_kind = 'on_duty' and p_file_key is null then raise exception 'Attach the proof (certificate or letter from the event)'; end if;
  if p_file_key is not null then
    v_dir := public.tenant_prefix(public.current_school_id()) || '/students/' || p_student || '/leave/';
    if left(p_file_key, length(v_dir)) <> v_dir or substr(p_file_key, length(v_dir) + 1) !~ '^[0-9a-f-]{36}\.(pdf|jpg|png)$' then raise exception 'Upload the proof first'; end if;
  end if;
  select section_id into v_sec from public.student_enrollment where student_id = p_student and academic_year_id = app.current_year_id() and status = 'active' limit 1;
  if v_sec is null then raise exception 'Not enrolled this year'; end if;
  insert into public.leave_application (school_id, student_id, section_id, academic_year_id, applied_by, from_date, to_date, reason, status, kind, file_key)
  values (public.current_school_id(), p_student, v_sec, app.current_year_id(), auth.uid(), p_from, p_to, left(trim(p_reason), 500), 'pending', p_kind, p_file_key) returning id into v_id;
  return v_id;
end $$;

-- approved: leave and medical turn absences into "leave"; on duty turns them into present
create or replace function public.leave_to_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, reason)
    select a.school_id, a.section_id, a.subject_id, a.on_date, a.period, new.decided_by, array[a.student_id], '{}',
           left(case new.kind when 'medical' then 'Medical leave approved' when 'on_duty' then 'On duty approved: ' || new.reason else 'Leave approved' end, 300)
    from public.attendance_record a where a.student_id = new.student_id and a.on_date between new.from_date and new.to_date and a.status = 'absent';
    update public.attendance_record set status = (case when new.kind = 'on_duty' then 'present' else 'leave' end)::public.attendance_status
     where student_id = new.student_id and on_date between new.from_date and new.to_date and status = 'absent';
  end if;
  return new;
end $$;
-- a lecture marked while on approved leave/medical is "leave"; while on approved duty it is present
create or replace function app.on_leave(p_student bigint, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_application l where l.student_id = p_student and l.status = 'approved' and l.kind <> 'on_duty' and p_day between l.from_date and l.to_date);
$$;
create or replace function app.on_duty(p_student bigint, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_application l where l.student_id = p_student and l.status = 'approved' and l.kind = 'on_duty' and p_day between l.from_date and l.to_date);
$$;
commit;
notify pgrst, 'reload schema';

begin;
create or replace function public.leave_upload_ok(p_student bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select public.current_school_id() where app.owns_student(p_student);
$$;
revoke all on function public.leave_upload_ok(bigint) from public, anon;
grant execute on function public.leave_upload_ok(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
