-- After review of 0199-0201: the lesson log key; leave inserts and proof files locked down; corrections only for lectures
-- and respecting the freeze; no false reason prompt; online tests: answers checked by kind, one bad attempt never blocks
-- others, answers shown only when no attempt is left, server time for the countdown, marks must be given.
begin;
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
  on conflict (coalesce(section_id, 0), subject_id, on_date, coalesce(period, 0), coalesce(component, '')) do update
    set topic_ids = excluded.topic_ids, summary = excluded.summary, staff_id = excluded.staff_id, updated_at = now()
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if coalesce(l ->> 'url', '') !~ '^https://' then raise exception 'Links start with https://'; end if;
    insert into public.lesson_material (school_id, lesson_id, title, url) values (v_school, v_id, left(coalesce(nullif(trim(l ->> 'title'), ''), 'Link'), 160), left(l ->> 'url', 1000));
  end loop;
  return v_id;
end $$;

drop policy if exists leave_insert on public.leave_application;
create policy leave_insert on public.leave_application for insert to authenticated with check (
  applied_by = auth.uid() and app.owns_student(student_id) and status = 'pending' and kind = 'leave' and file_key is null);

create or replace function public.leave_file_key(p_leave bigint) returns text
language sql stable security definer set search_path = '' as $$
  select l.file_key from public.leave_application l where l.id = p_leave and l.school_id = public.current_school_id()
    and l.file_key like public.tenant_prefix(l.school_id) || '/students/' || l.student_id || '/leave/%'
    and (app.owns_student(l.student_id) or coalesce(app.is_admin_scope(), false) or app.ct_of_section(l.section_id, l.academic_year_id));
$$;

create or replace function public.request_attendance_correction(p_student bigint, p_date date, p_period smallint, p_subject bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare a public.attendance_record; v_id bigint; v_teacher bigint;
begin
  if not app.owns_student(p_student) then raise exception 'Not allowed'; end if;
  if p_period is null or p_subject is null then raise exception 'Corrections are for a lecture (a period of a subject); for a whole day speak to the class teacher'; end if;
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
  if p_accept and not coalesce(app.is_admin_scope(), false) and public.lecture_lock_reason(c.section_id, c.subject_id, c.on_date) is not null then
    raise exception 'That day is frozen (%). The office can accept it.', public.lecture_lock_reason(c.section_id, c.subject_id, c.on_date);
  end if;
  update public.attendance_correction set status = case when p_accept then 'accepted' else 'declined' end, decided_by = app.my_staff_id(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300) where id = c.id;
  if p_accept then
    update public.attendance_record set status = 'present', marked_by = app.my_staff_id()
     where student_id = c.student_id and on_date = c.on_date and period is not distinct from c.period and subject_id is not distinct from c.subject_id and status = 'absent';
    if found and c.period is not null and c.subject_id is not null then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, reason)
    values (c.school_id, c.section_id, c.subject_id, c.on_date, c.period, app.my_staff_id(), array[c.student_id], '{}', left('Correction asked by the student: ' || c.reason, 300));
    end if;
  end if;
  perform public.notify_family(c.school_id, 'announcement', 'att-corr-done:' || c.id, c.student_id,
    jsonb_build_object('day', to_char(c.on_date, 'DD Mon')), case when p_accept then 'Attendance corrected' else 'Attendance correction declined' end,
    case when p_accept then 'The lecture on {day} is now marked present.' else 'The request for {day} was declined: ' || coalesce(p_note, '') end, '/dashboard/lectures');
end $$;

create or replace function public.leave_to_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent, reason)
    select a.school_id, a.section_id, a.subject_id, a.on_date, a.period, new.decided_by, array[a.student_id], '{}',
           left(case new.kind when 'medical' then 'Medical leave approved' when 'on_duty' then 'On duty approved: ' || new.reason else 'Leave approved' end, 300)
    from public.attendance_record a where a.student_id = new.student_id and a.on_date between new.from_date and new.to_date and a.status = 'absent' and a.period is not null and a.subject_id is not null;
    update public.attendance_record set status = (case when new.kind = 'on_duty' then 'present' else 'leave' end)::public.attendance_status
     where student_id = new.student_id and on_date between new.from_date and new.to_date and status = 'absent';
  end if;
  return new;
end $$;

create or replace function public.mark_lecture(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_absent bigint[],
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
  select count(*) > 0, coalesce(array_agg(a.student_id order by a.student_id) filter (where a.status in ('absent', 'leave') or (a.status = 'present' and a.student_id = any(v_new) and app.on_duty(a.student_id, p_date))), '{}') into v_had, v_old
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

create or replace function app.answer_ok(p_kind text, p_options jsonb, v jsonb) returns boolean
language sql immutable as $$
  select case
    when v is null or v = 'null'::jsonb then true
    when p_kind = 'single' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::int between 0 and jsonb_array_length(p_options) - 1
    when p_kind = 'multi' then jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= jsonb_array_length(p_options)
      and not exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric) or (x #>> '{}')::int not between 0 and jsonb_array_length(p_options) - 1)
    when p_kind = 'truefalse' then jsonb_typeof(v) = 'boolean'
    when p_kind = 'number' then jsonb_typeof(v) = 'number'
    when p_kind = 'short' then jsonb_typeof(v) = 'string'
    else false end;
$$;

create or replace function public.save_test_answer(p_attempt bigint, p_question bigint, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt;
begin
  select * into a from public.test_attempt where id = p_attempt and student_id = app.me_student() for update;
  if a.id is null then raise exception 'Unknown attempt'; end if;
  if a.submitted_at is not null then raise exception 'This attempt is already submitted'; end if;
  if now() > a.deadline then raise exception 'Time is up'; end if;
  if not (p_question = any(a.order_ids)) then raise exception 'Unknown question'; end if;
  if octet_length(coalesce(p_value, 'null'::jsonb)::text) > 6000 then raise exception 'The answer is too long'; end if;
  if not app.answer_ok((select kind from public.test_question where id = p_question), (select options from public.test_question where id = p_question), p_value) then raise exception 'That answer does not fit the question'; end if;
  if jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) = 0 then p_value := null; end if;
  update public.test_attempt set answers = case when p_value is null or p_value = 'null'::jsonb then answers - p_question::text else answers || jsonb_build_object(p_question::text, p_value) end where id = a.id;
end $$;

create or replace function app.close_overdue(p_test bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.test_attempt where test_id = p_test and submitted_at is null and deadline < now() loop
    begin
      update public.test_attempt set submitted_at = deadline where id = r.id;
      perform app.mark_attempt(r.id);
    exception when others then null;  -- one attempt never blocks the others
    end;
  end loop;
end $$;

create or replace function public.review_attempt(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt; t public.test_paper;
begin
  select * into a from public.test_attempt where id = p_attempt and school_id = public.current_school_id();
  if a.id is null then raise exception 'Unknown attempt'; end if;
  select * into t from public.test_paper where id = a.test_id;
  if not (app.owns_student(a.student_id) or app.can_run_test(t.subject_id, t.section_ids)) then raise exception 'Not allowed'; end if;
  if a.submitted_at is null then raise exception 'Not submitted yet'; end if;
  -- answers only once no attempt is left to take (or the test has closed), so a later attempt never sees them
  if not app.can_run_test(t.subject_id, t.section_ids) and not (t.show_answers <> 'never' and (now() > t.closes_at or (t.show_answers = 'after_submit'
       and (select count(*) from public.test_attempt x where x.test_id = t.id and x.student_id = a.student_id) >= t.attempts
       and not exists (select 1 from public.test_attempt x where x.test_id = t.id and x.student_id = a.student_id and x.submitted_at is null)))) then
    return jsonb_build_object('score', a.score, 'to_mark', a.to_mark, 'answers_shown', false);
  end if;
  return jsonb_build_object('score', a.score, 'to_mark', a.to_mark, 'answers_shown', true, 'questions',
    (select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'answer', q.answer, 'marks', q.marks,
       'given', a.answers -> q.id::text, 'got', a.scores -> q.id::text) order by array_position(a.order_ids, q.id)) from public.test_question q where q.test_id = t.id));
end $$;

create or replace function public.my_tests()
returns table (id bigint, title text, subject text, opens_at timestamptz, closes_at timestamptz, minutes int, attempts int, used int, open_attempt bigint, best numeric, total numeric, to_mark int, can_review boolean)
language plpgsql security definer set search_path = '' as $$
declare v_stu bigint := app.me_student(); r record;
begin
  if v_stu is null then return; end if;
  for r in select t.id from public.test_paper t where t.school_id = public.current_school_id() and t.published and app.test_is_for(t.id, v_stu) loop
    perform app.close_overdue(r.id);
  end loop;
  return query
  select t.id, t.title, sb.name, t.opens_at, t.closes_at, t.minutes, t.attempts,
    (select count(*)::int from public.test_attempt a where a.test_id = t.id and a.student_id = v_stu),
    (select a.id from public.test_attempt a where a.test_id = t.id and a.student_id = v_stu and a.submitted_at is null limit 1),
    (select max(a.score) from public.test_attempt a where a.test_id = t.id and a.student_id = v_stu and a.submitted_at is not null),
    (select sum(q.marks) from public.test_question q where q.test_id = t.id),
    (select coalesce(max(a.to_mark), 0) from public.test_attempt a where a.test_id = t.id and a.student_id = v_stu and a.submitted_at is not null),
    (t.show_answers <> 'never' and (now() > t.closes_at or (t.show_answers = 'after_submit' and (select count(*) from public.test_attempt x where x.test_id = t.id and x.student_id = v_stu) >= t.attempts)))
  from public.test_paper t join public.subject sb on sb.id = t.subject_id
  where t.school_id = public.current_school_id() and t.published and app.test_is_for(t.id, v_stu)
  order by t.closes_at desc;
end $$;

create or replace function public.start_test(p_test bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_stu bigint := app.me_student(); t public.test_paper; a public.test_attempt; v_no int;
begin
  if v_stu is null then raise exception 'Only the student can take the test'; end if;
  select * into t from public.test_paper where id = p_test and school_id = public.current_school_id();
  if t.id is null or not app.test_is_for(p_test, v_stu) then raise exception 'This test is not for you'; end if;
  perform app.close_overdue(p_test);
  select * into a from public.test_attempt where test_id = p_test and student_id = v_stu and submitted_at is null limit 1;
  if a.id is null then
    if now() < t.opens_at then raise exception 'The test opens at %', to_char(t.opens_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'); end if;
    if now() > t.closes_at then raise exception 'The test has closed'; end if;
    select count(*) + 1 into v_no from public.test_attempt where test_id = p_test and student_id = v_stu;
    if v_no > t.attempts then raise exception 'No attempts left'; end if;
    insert into public.test_attempt (school_id, test_id, student_id, attempt_no, deadline, order_ids)
    values (t.school_id, p_test, v_stu, v_no, least(now() + make_interval(mins => t.minutes), t.closes_at),
            array(select q.id from public.test_question q where q.test_id = p_test order by case when t.shuffle then random() else q.seq end))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'now', now(), 'title', t.title, 'instructions', t.instructions, 'answers', a.answers,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'marks', q.marks, 'negative', q.negative) order by array_position(a.order_ids, q.id))
                  from public.test_question q where q.test_id = p_test));
end $$;

create or replace function public.mark_short_answer(p_attempt bigint, p_question bigint, p_marks numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt; t public.test_paper; q public.test_question;
begin
  select * into a from public.test_attempt where id = p_attempt and school_id = public.current_school_id() for update;
  select * into t from public.test_paper where id = a.test_id;
  if a.id is null or not app.can_run_test(t.subject_id, t.section_ids) then raise exception 'Not allowed'; end if;
  select * into q from public.test_question where id = p_question and test_id = a.test_id and kind = 'short';
  if q.id is null then raise exception 'Unknown question'; end if;
  if p_marks is null or p_marks < 0 or p_marks > q.marks then raise exception 'Marks are 0 to %', q.marks; end if;
  if a.submitted_at is null then raise exception 'The attempt is not submitted yet'; end if;
  update public.test_attempt set scores = scores || jsonb_build_object(p_question::text, p_marks) where id = a.id;
  perform app.mark_attempt(a.id);
end $$;

create or replace function public.save_test(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id bigint := p_id; v_sub bigint := (p ->> 'subject_id')::bigint;
  v_secs bigint[] := array(select jsonb_array_elements_text(coalesce(p -> 'section_ids', '[]'::jsonb))::bigint); q jsonb; i int := 0; v_kind text;
begin
  if not exists (select 1 from public.subject where id = v_sub and school_id = v_school) then raise exception 'Choose the subject'; end if;
  if not app.can_run_test(v_sub, v_secs) then raise exception 'Only the subject''s teacher (of every section chosen) can set this test'; end if;
  if v_id is not null and not exists (select 1 from public.test_paper t where t.id = v_id and t.school_id = v_school and app.can_run_test(t.subject_id, t.section_ids)) then raise exception 'Unknown test'; end if;
  if jsonb_array_length(coalesce(p -> 'questions', '[]'::jsonb)) = 0 then raise exception 'Add at least one question'; end if;
  if v_id is null then
    insert into public.test_paper (school_id, academic_year_id, subject_id, section_ids, title, instructions, opens_at, closes_at, minutes, attempts, shuffle, show_answers, created_by)
    values (v_school, app.current_year_id(), v_sub, v_secs, left(trim(p ->> 'title'), 160), left(nullif(trim(p ->> 'instructions'), ''), 2000), (p ->> 'opens_at')::timestamptz, (p ->> 'closes_at')::timestamptz,
            (p ->> 'minutes')::int, coalesce((p ->> 'attempts')::int, 1), coalesce((p ->> 'shuffle')::boolean, false), coalesce(p ->> 'show_answers', 'after_close'), app.my_staff_id())
    returning id into v_id;
  else
    update public.test_paper set subject_id = v_sub, section_ids = v_secs, title = left(trim(p ->> 'title'), 160), instructions = left(nullif(trim(p ->> 'instructions'), ''), 2000),
      opens_at = (p ->> 'opens_at')::timestamptz, closes_at = (p ->> 'closes_at')::timestamptz, minutes = (p ->> 'minutes')::int, attempts = coalesce((p ->> 'attempts')::int, 1),
      shuffle = coalesce((p ->> 'shuffle')::boolean, false), show_answers = coalesce(p ->> 'show_answers', 'after_close') where id = v_id;
  end if;
  if exists (select 1 from public.test_attempt where test_id = v_id) then return v_id; end if;   -- the questions stay as they were
  delete from public.test_question where test_id = v_id;
  for q in select * from jsonb_array_elements(p -> 'questions') loop
    i := i + 1;
    v_kind := q ->> 'kind';
    if v_kind not in ('single', 'multi', 'truefalse', 'number', 'short') then raise exception 'Question %: unknown kind', i; end if;
    if nullif(trim(q ->> 'prompt'), '') is null then raise exception 'Question %: write the question', i; end if;
    if v_kind in ('single', 'multi') and jsonb_array_length(coalesce(q -> 'options', '[]'::jsonb)) < 2 then raise exception 'Question %: give at least two choices', i; end if;
    if v_kind <> 'short' and ((q -> 'answer') is null or q -> 'answer' = 'null'::jsonb or not app.answer_ok(v_kind, coalesce(q -> 'options', '[]'::jsonb), case when v_kind = 'number' then q -> 'answer' -> 'value' else q -> 'answer' end)
        or (v_kind = 'multi' and jsonb_array_length(q -> 'answer') = 0)) then raise exception 'Question %: mark the correct answer', i; end if;
    insert into public.test_question (school_id, test_id, seq, kind, prompt, options, answer, marks, negative)
    values (v_school, v_id, i, v_kind, left(trim(q ->> 'prompt'), 4000), coalesce(q -> 'options', '[]'::jsonb), q -> 'answer', coalesce((q ->> 'marks')::numeric, 1), coalesce((q ->> 'negative')::numeric, 0));
  end loop;
  return v_id;
end $$;

revoke all on function app.mark_attempt(bigint) from public, anon, authenticated;
revoke all on function app.close_overdue(bigint) from public, anon, authenticated;
commit;
notify pgrst, 'reload schema';
