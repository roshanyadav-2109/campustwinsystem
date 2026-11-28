-- Online tests and quizzes (schools and colleges).
--   test_paper: a teacher's test for one subject and one or more of their sections; opens and closes at set times,
--   with a time limit and the number of attempts allowed.
--   test_question: single choice, several choices, true/false, a number (with tolerance), or a short written answer.
--   test_attempt: a student's attempt; answers saved as they are chosen; the deadline is kept by the server.
-- The correct answers never leave the database before the results may be seen: students read questions only through
-- start_test (without answers) and are marked in submit_test. Questions are locked once anyone has started.
begin;

create table if not exists public.test_paper (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  subject_id       bigint not null references public.subject(id) on delete cascade,
  section_ids      bigint[] not null check (cardinality(section_ids) between 1 and 40),
  title            text not null check (char_length(title) between 1 and 160),
  instructions     text check (instructions is null or char_length(instructions) <= 2000),
  opens_at         timestamptz not null,
  closes_at        timestamptz not null,
  minutes          int not null check (minutes between 1 and 600),
  attempts         int not null default 1 check (attempts between 1 and 10),
  shuffle          boolean not null default false,
  show_answers     text not null default 'after_close' check (show_answers in ('after_submit', 'after_close', 'never')),
  published        boolean not null default false,
  created_by       bigint references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index if not exists idx_test_paper_subject on public.test_paper (subject_id, academic_year_id);
create index if not exists idx_fk_test_paper_created_by on public.test_paper (created_by) where created_by is not null;
create table if not exists public.test_question (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  test_id   bigint not null references public.test_paper(id) on delete cascade,
  seq       int not null,
  kind      text not null check (kind in ('single', 'multi', 'truefalse', 'number', 'short')),
  prompt    text not null check (char_length(prompt) between 1 and 4000),
  options   jsonb not null default '[]'::jsonb,                 -- choices (single/multi)
  answer    jsonb,                                              -- index, [indexes], true/false, {"value": n, "tolerance": t}, or model answer text
  marks     numeric(6,2) not null default 1 check (marks > 0 and marks <= 100),
  negative  numeric(6,2) not null default 0 check (negative >= 0 and negative <= 100),
  unique (test_id, seq)
);
create table if not exists public.test_attempt (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  test_id     bigint not null references public.test_paper(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  attempt_no  int not null,
  started_at  timestamptz not null default now(),
  deadline    timestamptz not null,
  submitted_at timestamptz,
  answers     jsonb not null default '{}'::jsonb,               -- {question_id: value}
  order_ids   bigint[] not null default '{}',                   -- the order shown to this student
  scores      jsonb not null default '{}'::jsonb,               -- {question_id: marks}
  score       numeric(8,2),
  to_mark     int not null default 0,                           -- short answers still to be marked by the teacher
  unique (test_id, student_id, attempt_no)
);
create index if not exists idx_test_attempt_student on public.test_attempt (student_id, test_id);
do $$ declare t text; begin
  foreach t in array array['test_paper', 'test_question', 'test_attempt'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- (no direct access for users: everything goes through the functions below)

-- may manage this test: teaches the subject in every section of it, or runs the institution
create or replace function app.can_run_test(p_subject bigint, p_sections bigint[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_admin_scope(), false) or (cardinality(p_sections) > 0 and not exists (
    select 1 from unnest(p_sections) s where not exists (
      select 1 from public.teacher_allotment a where a.staff_id = app.my_staff_id() and a.subject_id = p_subject and a.section_id = s and a.academic_year_id = app.current_year_id())));
$$;
-- the signed-in student (not a parent) and whether this test is for them
create or replace function app.me_student() returns bigint
language sql stable security definer set search_path = '' as $$
  select student_id from public.profile where id = auth.uid() and role = 'student';
$$;
create or replace function app.test_is_for(p_test bigint, p_student bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.test_paper t join public.student_enrollment e on e.student_id = p_student and e.status = 'active' and e.academic_year_id = t.academic_year_id
                 where t.id = p_test and t.published and e.section_id = any(t.section_ids)
                   and (not public.subject_is_elective(t.subject_id) or exists (
                     select 1 from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.subject sb on sb.id = t.subject_id and sb.course_id = pc.course_id
                     join public.semester s on s.id = r.semester_id and s.is_current where r.student_id = p_student and r.status <> 'dropped')));
$$;
grant execute on function app.can_run_test(bigint, bigint[]) to authenticated;
grant execute on function app.me_student() to authenticated;
grant execute on function app.test_is_for(bigint, bigint) to authenticated;

-- the teacher saves a test with its questions (questions are locked once anyone has started)
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
    if v_kind <> 'short' and (q -> 'answer') is null then raise exception 'Question %: mark the correct answer', i; end if;
    insert into public.test_question (school_id, test_id, seq, kind, prompt, options, answer, marks, negative)
    values (v_school, v_id, i, v_kind, left(trim(q ->> 'prompt'), 4000), coalesce(q -> 'options', '[]'::jsonb), q -> 'answer', coalesce((q ->> 'marks')::numeric, 1), coalesce((q ->> 'negative')::numeric, 0));
  end loop;
  return v_id;
end $$;
revoke all on function public.save_test(bigint, jsonb) from public, anon;
grant execute on function public.save_test(bigint, jsonb) to authenticated;

create or replace function public.publish_test(p_id bigint, p_publish boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.test_paper t set published = p_publish where t.id = p_id and t.school_id = public.current_school_id() and app.can_run_test(t.subject_id, t.section_ids);
  if not found then raise exception 'Unknown test'; end if;
end $$;
revoke all on function public.publish_test(bigint, boolean) from public, anon;
grant execute on function public.publish_test(bigint, boolean) to authenticated;

-- the teacher's view of a test (with answers), for editing
create or replace function public.test_for_teacher(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(t) || jsonb_build_object('locked', exists (select 1 from public.test_attempt a where a.test_id = t.id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'answer', q.answer, 'marks', q.marks, 'negative', q.negative) order by q.seq) from public.test_question q where q.test_id = t.id), '[]'::jsonb))
  from public.test_paper t where t.id = p_id and t.school_id = public.current_school_id() and app.can_run_test(t.subject_id, t.section_ids);
$$;
revoke all on function public.test_for_teacher(bigint) from public, anon;
grant execute on function public.test_for_teacher(bigint) to authenticated;

-- marking an attempt (objective questions now; short answers wait for the teacher)
create or replace function app.mark_attempt(p_attempt bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt; q record; v jsonb; got numeric; sc jsonb := '{}'::jsonb; total numeric := 0; pending int := 0;
begin
  select * into a from public.test_attempt where id = p_attempt for update;
  for q in select * from public.test_question where test_id = a.test_id loop
    v := a.answers -> q.id::text;
    got := null;
    if q.kind = 'short' then
      if a.scores ? q.id::text then got := (a.scores ->> q.id::text)::numeric; elsif v is not null and nullif(trim(v #>> '{}'), '') is not null then pending := pending + 1; else got := 0; end if;
    elsif v is null or v = 'null'::jsonb then got := 0;
    elsif q.kind = 'single' then got := case when v = q.answer then q.marks else -q.negative end;
    elsif q.kind = 'truefalse' then got := case when v = q.answer then q.marks else -q.negative end;
    elsif q.kind = 'multi' then
      got := case when (select coalesce(array_agg(x::int order by x::int), '{}') from jsonb_array_elements_text(v) x) = (select coalesce(array_agg(x::int order by x::int), '{}') from jsonb_array_elements_text(q.answer) x) then q.marks else -q.negative end;
    elsif q.kind = 'number' then
      got := case when jsonb_typeof(v) = 'number' and abs((v #>> '{}')::numeric - (q.answer ->> 'value')::numeric) <= coalesce((q.answer ->> 'tolerance')::numeric, 0) then q.marks else -q.negative end;
    end if;
    if got is not null then sc := sc || jsonb_build_object(q.id::text, got); total := total + got; end if;
  end loop;
  update public.test_attempt set scores = sc, score = greatest(total, 0), to_mark = pending where id = a.id;
end $$;

-- attempts whose time ran out are submitted (as answered so far)
create or replace function app.close_overdue(p_test bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.test_attempt where test_id = p_test and submitted_at is null and deadline < now() loop
    update public.test_attempt set submitted_at = deadline where id = r.id;
    perform app.mark_attempt(r.id);
  end loop;
end $$;

-- the student's tests: open, upcoming and done, with their score once it may be seen
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
    (t.show_answers = 'after_submit' or (t.show_answers = 'after_close' and now() > t.closes_at))
  from public.test_paper t join public.subject sb on sb.id = t.subject_id
  where t.school_id = public.current_school_id() and t.published and app.test_is_for(t.id, v_stu)
  order by t.closes_at desc;
end $$;
revoke all on function public.my_tests() from public, anon;
grant execute on function public.my_tests() to authenticated;

-- start (or continue) an attempt: questions without their answers, in this student's order
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
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'title', t.title, 'instructions', t.instructions, 'answers', a.answers,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'marks', q.marks, 'negative', q.negative) order by array_position(a.order_ids, q.id))
                  from public.test_question q where q.test_id = p_test));
end $$;
revoke all on function public.start_test(bigint) from public, anon;
grant execute on function public.start_test(bigint) to authenticated;

-- each answer is kept as it is chosen, until the deadline
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
  update public.test_attempt set answers = case when p_value is null or p_value = 'null'::jsonb then answers - p_question::text else answers || jsonb_build_object(p_question::text, p_value) end where id = a.id;
end $$;
revoke all on function public.save_test_answer(bigint, bigint, jsonb) from public, anon;
grant execute on function public.save_test_answer(bigint, bigint, jsonb) to authenticated;

create or replace function public.submit_test(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt;
begin
  select * into a from public.test_attempt where id = p_attempt and student_id = app.me_student() for update;
  if a.id is null then raise exception 'Unknown attempt'; end if;
  if a.submitted_at is null then
    update public.test_attempt set submitted_at = least(now(), deadline) where id = a.id;
    perform app.mark_attempt(a.id);
  end if;
  select * into a from public.test_attempt where id = p_attempt;
  return jsonb_build_object('score', a.score, 'to_mark', a.to_mark);
end $$;
revoke all on function public.submit_test(bigint) from public, anon;
grant execute on function public.submit_test(bigint) to authenticated;

-- the student's review (answers and the correct ones), when the test allows it
create or replace function public.review_attempt(p_attempt bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt; t public.test_paper;
begin
  select * into a from public.test_attempt where id = p_attempt and school_id = public.current_school_id();
  if a.id is null then raise exception 'Unknown attempt'; end if;
  select * into t from public.test_paper where id = a.test_id;
  if not (app.owns_student(a.student_id) or app.can_run_test(t.subject_id, t.section_ids)) then raise exception 'Not allowed'; end if;
  if a.submitted_at is null then raise exception 'Not submitted yet'; end if;
  if not app.can_run_test(t.subject_id, t.section_ids) and not (t.show_answers = 'after_submit' or (t.show_answers = 'after_close' and now() > t.closes_at)) then
    return jsonb_build_object('score', a.score, 'to_mark', a.to_mark, 'answers_shown', false);
  end if;
  return jsonb_build_object('score', a.score, 'to_mark', a.to_mark, 'answers_shown', true, 'questions',
    (select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'answer', q.answer, 'marks', q.marks,
       'given', a.answers -> q.id::text, 'got', a.scores -> q.id::text) order by array_position(a.order_ids, q.id)) from public.test_question q where q.test_id = t.id));
end $$;
revoke all on function public.review_attempt(bigint) from public, anon;
grant execute on function public.review_attempt(bigint) to authenticated;

-- the teacher: tests they run, and the results of one
create or replace function public.my_set_tests()
returns table (id bigint, title text, subject text, sections text, opens_at timestamptz, closes_at timestamptz, published boolean, attempts int, to_mark int)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, sb.name,
    (select string_agg(c.name || '-' || s.name, ', ' order by c.level, s.name) from public.section s join public.class c on c.id = s.class_id where s.id = any(t.section_ids)),
    t.opens_at, t.closes_at, t.published,
    (select count(*)::int from public.test_attempt a where a.test_id = t.id and a.submitted_at is not null),
    (select coalesce(sum(a.to_mark), 0)::int from public.test_attempt a where a.test_id = t.id)
  from public.test_paper t join public.subject sb on sb.id = t.subject_id
  where t.school_id = public.current_school_id() and t.academic_year_id = app.current_year_id() and app.can_run_test(t.subject_id, t.section_ids)
  order by t.opens_at desc;
$$;
revoke all on function public.my_set_tests() from public, anon;
grant execute on function public.my_set_tests() to authenticated;

create or replace function public.test_results(p_test bigint)
returns table (attempt_id bigint, student_id bigint, student_name text, section text, attempt_no int, submitted_at timestamptz, score numeric, to_mark int, total numeric)
language plpgsql security definer set search_path = '' as $$
declare t public.test_paper;
begin
  select * into t from public.test_paper where id = p_test and school_id = public.current_school_id();
  if t.id is null or not app.can_run_test(t.subject_id, t.section_ids) then raise exception 'Unknown test'; end if;
  perform app.close_overdue(p_test);
  return query
  select a.id, a.student_id, st.full_name, c.name || '-' || s.name, a.attempt_no, a.submitted_at, a.score, a.to_mark, (select sum(q.marks) from public.test_question q where q.test_id = p_test)
  from public.test_attempt a join public.student st on st.id = a.student_id
  left join public.student_enrollment e on e.student_id = a.student_id and e.academic_year_id = t.academic_year_id and e.status = 'active'
  left join public.section s on s.id = e.section_id left join public.class c on c.id = s.class_id
  where a.test_id = p_test order by st.full_name, a.attempt_no;
end $$;
revoke all on function public.test_results(bigint) from public, anon;
grant execute on function public.test_results(bigint) to authenticated;

-- the teacher marks a short answer
create or replace function public.mark_short_answer(p_attempt bigint, p_question bigint, p_marks numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.test_attempt; t public.test_paper; q public.test_question;
begin
  select * into a from public.test_attempt where id = p_attempt and school_id = public.current_school_id() for update;
  select * into t from public.test_paper where id = a.test_id;
  if a.id is null or not app.can_run_test(t.subject_id, t.section_ids) then raise exception 'Not allowed'; end if;
  select * into q from public.test_question where id = p_question and test_id = a.test_id and kind = 'short';
  if q.id is null then raise exception 'Unknown question'; end if;
  if p_marks < 0 or p_marks > q.marks then raise exception 'Marks are 0 to %', q.marks; end if;
  update public.test_attempt set scores = scores || jsonb_build_object(p_question::text, p_marks) where id = a.id;
  perform app.mark_attempt(a.id);
end $$;
revoke all on function public.mark_short_answer(bigint, bigint, numeric) from public, anon;
grant execute on function public.mark_short_answer(bigint, bigint, numeric) to authenticated;

-- the student's latest submitted attempt of each test (for "see answers")
create or replace function public.my_test_attempts()
returns table (test_id bigint, attempt_id bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (a.test_id) a.test_id, a.id from public.test_attempt a
  where a.student_id = app.me_student() and a.submitted_at is not null and a.school_id = public.current_school_id()
  order by a.test_id, a.attempt_no desc;
$$;
revoke all on function public.my_test_attempts() from public, anon;
grant execute on function public.my_test_attempts() to authenticated;
commit;
notify pgrst, 'reload schema';
