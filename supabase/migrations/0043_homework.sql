-- =============================================================================
-- Migration 0043 — Homework and assignments
--   homework            : a piece of homework set for one section + subject
--   homework_submission : one row per student who marked it done; later carries
--                         the teacher's marks and remark
--
-- Read access
--   * homework   : principal/office (everything); a teacher sees the homework of
--                  every section they are allotted to this year; a student or
--                  guardian sees their own (child's) section this year.
--   * submission : principal/office; staff allotted to the homework's section;
--                  the student themself / their guardian.
-- Write access
--   * homework   : the teacher who set it, while they still teach that subject
--                  in that section (or are its class teacher). Principal and
--                  office are read only.
--   * submission : nobody writes the table directly. Families go through
--                  public.homework_submit(), teachers through
--                  public.homework_check(); each checks the caller's rights and
--                  touches only its own columns.
-- Only creates new objects. Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.homework (
  id               bigint generated always as identity primary key,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  section_id       bigint not null references public.section(id) on delete cascade,
  subject_id       bigint not null references public.subject(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  instructions     text not null default '' check (char_length(instructions) <= 2000),
  due_date         date not null,
  link_url         text check (link_url is null or (link_url like 'https://%' and char_length(link_url) <= 500)),
  max_marks        numeric(6,2) check (max_marks is null or max_marks > 0),
  created_by       bigint not null references public.staff(id),
  created_at       timestamptz not null default now()
);

create index if not exists idx_homework_section_year on public.homework(section_id, academic_year_id, due_date);
create index if not exists idx_homework_subject      on public.homework(subject_id);
create index if not exists idx_homework_created_by   on public.homework(created_by);
create index if not exists idx_homework_year         on public.homework(academic_year_id);

create table if not exists public.homework_submission (
  id           bigint generated always as identity primary key,
  homework_id  bigint not null references public.homework(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  note         text check (note is null or char_length(note) <= 1000),
  link_url     text check (link_url is null or (link_url like 'https://%' and char_length(link_url) <= 500)),
  submitted_at timestamptz not null default now(),
  is_late      boolean not null default false,
  marks        numeric(6,2) check (marks is null or marks >= 0),
  remark       text check (remark is null or char_length(remark) <= 500),
  checked_by   bigint references public.staff(id) on delete set null,
  checked_at   timestamptz,
  unique (homework_id, student_id)
);

-- unique (homework_id, student_id) already serves look-ups by homework.
create index if not exists idx_hw_submission_student on public.homework_submission(student_id);
create index if not exists idx_hw_submission_checker on public.homework_submission(checked_by);

-- ---------------------------------------------------------------------------
-- Helper: sections whose homework the caller may read this year
--   taught sections (any allotment) ∪ current sections of the caller's own
--   students. A set, so the policy check runs once per query, not per row
--   (see 0004_rls_performance.sql).
-- ---------------------------------------------------------------------------
create or replace function app.my_homework_sections()
returns setof bigint language sql stable security definer set search_path = public, pg_temp as $$
  select app.my_taught_sections()
  union
  select e.section_id from public.student_enrollment e
  where e.academic_year_id = app.current_year_id()
    and e.student_id in (select app.my_owned_students());
$$;
revoke execute on function app.my_homework_sections() from public, anon;
grant execute on function app.my_homework_sections() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.homework            enable row level security;
alter table public.homework_submission enable row level security;

drop policy if exists homework_read   on public.homework;
drop policy if exists homework_insert on public.homework;
drop policy if exists homework_update on public.homework;
drop policy if exists homework_delete on public.homework;

create policy homework_read on public.homework
  for select to authenticated using (
    (select app.is_admin_scope())
    or (academic_year_id = (select app.current_year_id())
        and section_id in (select app.my_homework_sections()))
  );

-- The teacher who sets it must teach that subject in that section this year,
-- or be the section's class teacher. Principal/office get no write policy.
create policy homework_insert on public.homework
  for insert to authenticated with check (
    created_by = (select app.my_staff_id())
    and academic_year_id = (select app.current_year_id())
    and (section_id in (select app.my_ct_sections())
         or (section_id, subject_id) in (select p.section_id, p.subject_id from app.my_allot_pairs() p))
  );
create policy homework_update on public.homework
  for update to authenticated using (
    created_by = (select app.my_staff_id())
    and academic_year_id = (select app.current_year_id())
    and (section_id in (select app.my_ct_sections())
         or (section_id, subject_id) in (select p.section_id, p.subject_id from app.my_allot_pairs() p))
  ) with check (
    created_by = (select app.my_staff_id())
    and academic_year_id = (select app.current_year_id())
    and (section_id in (select app.my_ct_sections())
         or (section_id, subject_id) in (select p.section_id, p.subject_id from app.my_allot_pairs() p))
  );
create policy homework_delete on public.homework
  for delete to authenticated using (
    created_by = (select app.my_staff_id())
    and academic_year_id = (select app.current_year_id())
    and (section_id in (select app.my_ct_sections())
         or (section_id, subject_id) in (select p.section_id, p.subject_id from app.my_allot_pairs() p))
  );

-- Submissions: read only. No insert/update/delete policy exists, so every
-- direct write is refused; the two functions below are the only way in.
drop policy if exists homework_submission_read on public.homework_submission;
create policy homework_submission_read on public.homework_submission
  for select to authenticated using (
    (select app.is_admin_scope())
    or student_id in (select app.my_owned_students())
    or homework_id in (
      select h.id from public.homework h
      where h.academic_year_id = (select app.current_year_id())
        and h.section_id in (select app.my_taught_sections())
    )
  );

revoke all on public.homework            from anon;
revoke all on public.homework_submission from anon;
grant select, insert, update, delete on public.homework to authenticated;
revoke insert, update, delete, truncate on public.homework_submission from authenticated;
grant select on public.homework_submission to authenticated;

-- ---------------------------------------------------------------------------
-- homework_submit — a student (or their guardian) marks homework as done, or
-- changes what they sent, until the teacher has checked it. Only note,
-- link_url, submitted_at and is_late are ever written here.
-- ---------------------------------------------------------------------------
create or replace function public.homework_submit(
  p_homework bigint, p_student bigint, p_note text, p_link text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hw   public.homework%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_checked timestamptz;
  v_id   bigint;
begin
  if p_student is null or not app.owns_student(p_student) then
    raise exception 'You can only submit homework for yourself or your own child.';
  end if;

  select * into v_hw from public.homework where id = p_homework;
  if not found then raise exception 'This homework no longer exists.'; end if;

  if not exists (
    select 1 from public.student_enrollment e
    where e.student_id = p_student
      and e.section_id = v_hw.section_id
      and e.academic_year_id = v_hw.academic_year_id
  ) then
    raise exception 'This homework was not set for this student.';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note is too long. Keep it under 1000 characters.';
  end if;
  if v_link is not null and (v_link not like 'https://%' or char_length(v_link) > 500 or v_link ~ '\s') then
    raise exception 'The link must start with https:// and be under 500 characters.';
  end if;

  select s.checked_at into v_checked from public.homework_submission s
  where s.homework_id = p_homework and s.student_id = p_student
  for update;
  if found and v_checked is not null then
    raise exception 'This homework has already been checked and cannot be changed.';
  end if;

  insert into public.homework_submission (homework_id, student_id, note, link_url, submitted_at, is_late)
    values (p_homework, p_student, v_note, v_link, now(), app.school_today() > v_hw.due_date)
  on conflict (homework_id, student_id) do update
    set note = excluded.note,
        link_url = excluded.link_url,
        submitted_at = excluded.submitted_at,
        is_late = excluded.is_late
    where homework_submission.checked_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'This homework has already been checked and cannot be changed.';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- homework_check — the subject's teacher (or the section's class teacher)
-- records marks and a remark against a submission. Only marks, remark,
-- checked_by and checked_at are ever written here.
-- ---------------------------------------------------------------------------
create or replace function public.homework_check(
  p_submission bigint, p_marks numeric, p_remark text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hw     public.homework%rowtype;
  v_hw_id  bigint;
  v_staff  bigint := app.my_staff_id();
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
begin
  if v_staff is null then
    raise exception 'Only a teacher can check homework.';
  end if;

  select s.homework_id into v_hw_id from public.homework_submission s where s.id = p_submission for update;
  if not found then raise exception 'This submission no longer exists.'; end if;
  select * into v_hw from public.homework where id = v_hw_id;

  if not app.teaches_subject(v_hw.section_id, v_hw.subject_id, v_hw.academic_year_id) then
    raise exception 'Only the teacher of this subject or the class teacher can check this homework.';
  end if;

  if p_marks is not null then
    if v_hw.max_marks is null then
      raise exception 'This homework does not carry marks.';
    end if;
    if p_marks < 0 or p_marks > v_hw.max_marks then
      raise exception 'Marks must be between 0 and %.', trim(to_char(v_hw.max_marks, 'FM999990.##'), '.');
    end if;
  end if;
  if v_remark is not null and char_length(v_remark) > 500 then
    raise exception 'The remark is too long. Keep it under 500 characters.';
  end if;

  update public.homework_submission
    set marks = p_marks, remark = v_remark, checked_by = v_staff, checked_at = now()
  where id = p_submission;
  return p_submission;
end $$;

revoke execute on function public.homework_submit(bigint, bigint, text, text) from public, anon;
revoke execute on function public.homework_check(bigint, numeric, text)       from public, anon;
grant execute on function public.homework_submit(bigint, bigint, text, text) to authenticated, service_role;
grant execute on function public.homework_check(bigint, numeric, text)       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Counts for the lists. Plain (security invoker) functions: they run under the
-- caller's own row rules, so each person counts only what they may already read.
-- ---------------------------------------------------------------------------
create or replace function public.homework_submission_counts(p_ids bigint[])
returns table(homework_id bigint, submitted integer, checked integer)
language sql stable set search_path = public, pg_temp as $$
  select s.homework_id, count(*)::int, count(s.checked_at)::int
  from public.homework_submission s
  where s.homework_id = any(p_ids)
  group by s.homework_id;
$$;

create or replace function public.homework_section_sizes(p_year bigint)
returns table(section_id bigint, students integer)
language sql stable set search_path = public, pg_temp as $$
  select e.section_id, count(*)::int
  from public.student_enrollment e
  where e.academic_year_id = p_year and e.status <> 'transferred'
  group by e.section_id;
$$;

revoke execute on function public.homework_submission_counts(bigint[]) from public, anon;
revoke execute on function public.homework_section_sizes(bigint)       from public, anon;
grant execute on function public.homework_submission_counts(bigint[]) to authenticated, service_role;
grant execute on function public.homework_section_sizes(bigint)       to authenticated, service_role;

notify pgrst, 'reload schema';
