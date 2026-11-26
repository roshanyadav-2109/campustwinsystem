-- Exam timetable (date sheet) and admit cards.
-- An exam (e.g. "Half-Yearly Examination") has papers per class: subject,
-- date, start and end time, maximum marks. Saving a paper creates (or updates)
-- the marks column in every section of that class, so marks entry and report
-- cards work without any other step. Two papers of a class cannot overlap.
-- Admit cards: one per student per exam, with a check code for the QR; an
-- exam can withhold admit cards from students with overdue fees (off by
-- default). Parents see the date sheet and download the admit card once the
-- office publishes the exam.
begin;

create table if not exists public.exam_session (
  id                  bigint generated always as identity primary key,
  school_id           bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id    bigint not null references public.academic_year(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 80),
  term                smallint not null check (term between 1 and 6),
  assessment_type_id  bigint not null references public.assessment_type(id) on delete restrict,
  instructions        text check (instructions is null or char_length(instructions) <= 1500),
  withhold_fee_dues   boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (school_id, academic_year_id, name)
);

create table if not exists public.exam_paper (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id   bigint not null references public.exam_session(id) on delete cascade,
  class_id     bigint not null references public.class(id) on delete cascade,
  subject_id   bigint not null references public.subject(id) on delete cascade,
  exam_date    date not null,
  starts_at    time not null,
  ends_at      time not null,
  max_marks    numeric(6,2) not null check (max_marks > 0),
  note         text check (note is null or char_length(note) <= 120),
  unique (session_id, class_id, subject_id),
  check (ends_at > starts_at)
);
create index if not exists idx_exam_paper_class_date on public.exam_paper (class_id, exam_date);

alter table public.assessment add column if not exists exam_paper_id bigint references public.exam_paper(id) on delete set null;
create index if not exists idx_assessment_exam_paper on public.assessment (exam_paper_id) where exam_paper_id is not null;

create table if not exists public.exam_admit_card (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id   bigint not null references public.exam_session(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  verify_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_at   timestamptz not null default now(),
  unique (session_id, student_id)
);

-- ---------- security ----------
do $$ declare t text; begin
  foreach t in array array['exam_session', 'exam_paper', 'exam_admit_card'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on public.exam_session, public.exam_paper to authenticated;
grant select on public.exam_admit_card to authenticated;
-- staff see all exams; families see published ones; only the office writes
drop policy if exists es_read on public.exam_session;
create policy es_read on public.exam_session for select to authenticated
  using ((select app.my_staff_id()) is not null or published_at is not null);
drop policy if exists es_write on public.exam_session;
create policy es_write on public.exam_session for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
drop policy if exists ep_read on public.exam_paper;
create policy ep_read on public.exam_paper for select to authenticated
  using ((select app.my_staff_id()) is not null or exists (select 1 from public.exam_session s where s.id = session_id and s.published_at is not null));
drop policy if exists ep_write on public.exam_paper;
create policy ep_write on public.exam_paper for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
drop policy if exists eac_read on public.exam_admit_card;
create policy eac_read on public.exam_admit_card for select to authenticated
  using ((select app.is_admin_scope()) or app.owns_student(student_id));

-- same institution; a class's papers never overlap; paper -> marks columns
create or replace function public.exam_paper_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_clash text;
begin
  select * into v_s from public.exam_session where id = new.session_id;
  if v_s.school_id is distinct from new.school_id
     or not exists (select 1 from public.class c where c.id = new.class_id and c.school_id = new.school_id)
     or not exists (select 1 from public.subject sb where sb.id = new.subject_id and sb.school_id = new.school_id) then
    raise exception 'That record belongs to another institution';
  end if;
  select sb.name into v_clash from public.exam_paper p join public.subject sb on sb.id = p.subject_id
   where p.class_id = new.class_id and p.exam_date = new.exam_date and p.id is distinct from new.id
     and p.starts_at < new.ends_at and new.starts_at < p.ends_at limit 1;
  if v_clash is not null then raise exception 'This clashes with % for the same class at that time', v_clash; end if;
  return new;
end $$;
drop trigger if exists trg_exam_paper_guard on public.exam_paper;
create trigger trg_exam_paper_guard before insert or update on public.exam_paper for each row execute function public.exam_paper_guard();

create or replace function public.exam_session_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.academic_year y where y.id = new.academic_year_id and y.school_id = new.school_id)
     or not exists (select 1 from public.assessment_type t where t.id = new.assessment_type_id and t.school_id = new.school_id and t.is_numeric) then
    raise exception 'Choose this institution''s year and an exam type with marks';
  end if;
  return new;
end $$;
drop trigger if exists trg_exam_session_guard on public.exam_session;
create trigger trg_exam_session_guard before insert or update on public.exam_session for each row execute function public.exam_session_guard();

-- keep each section's marks column in step with the paper
create or replace function public.exam_paper_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_sec record;
begin
  select * into v_s from public.exam_session where id = new.session_id;
  for v_sec in select id from public.section where class_id = new.class_id and school_id = new.school_id loop
    update public.assessment set name = v_s.name, term = v_s.term, assessment_type_id = v_s.assessment_type_id,
      assessed_on = new.exam_date, max_marks = new.max_marks
     where exam_paper_id = new.id and section_id = v_sec.id;
    if not found then
      insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, school_id, exam_paper_id, created_by)
      values (v_s.assessment_type_id, new.subject_id, v_sec.id, v_s.academic_year_id, v_s.term, v_s.name, new.exam_date, new.max_marks, new.school_id, new.id, app.my_staff_id());
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists trg_exam_paper_sync on public.exam_paper;
create trigger trg_exam_paper_sync after insert or update on public.exam_paper for each row execute function public.exam_paper_sync();

-- a paper with marks already entered cannot be removed
create or replace function public.exam_paper_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.assessment a join public.mark m on m.assessment_id = a.id where a.exam_paper_id = old.id) then
    raise exception 'Marks are already entered for this paper. Change its date instead of removing it.';
  end if;
  delete from public.assessment where exam_paper_id = old.id;
  return old;
end $$;
drop trigger if exists trg_exam_paper_delete_guard on public.exam_paper;
create trigger trg_exam_paper_delete_guard before delete on public.exam_paper for each row execute function public.exam_paper_delete_guard();

-- ---------- admit cards ----------
-- Students of a section (or one student) for an exam; returns one row per
-- student with whether the card is withheld and why. Creates the cards' check codes.
create or replace function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not app.is_admin_scope() and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  on conflict do nothing;
  return query
  select st.id, st.full_name, st.admission_no, e.roll_no::int, c.name || '-' || sec.name, st.photo_path,
    (v_s.withhold_fee_dues and due.bal > 0), case when v_s.withhold_fee_dues and due.bal > 0 then 'Fees overdue: Rs ' || to_char(due.bal, 'FM99,99,99,990.00') end,
    ac.verify_token
  from public.student_enrollment e
  join public.student st on st.id = e.student_id
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
  left join lateral (select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) bal from public.fee_invoice i
                     where i.student_id = st.id and i.status in ('due', 'part') and i.due_date < coalesce(v_first, current_date)) due on true
  where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  order by e.roll_no nulls last, st.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;

create or replace function public.verify_admit_card(p_token text)
returns table (valid boolean, student_name text, class_label text, exam_name text, school_name text)
language sql stable security definer set search_path = '' as $$
  select st.status = 'active', st.full_name,
         (select c.name || '-' || sec.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
           where e.student_id = st.id and e.academic_year_id = s.academic_year_id limit 1),
         s.name, sc.name
  from public.exam_admit_card ac join public.exam_session s on s.id = ac.session_id
  join public.student st on st.id = ac.student_id join public.school sc on sc.id = ac.school_id
  where ac.verify_token = p_token and length(p_token) between 20 and 64;
$$;
grant execute on function public.verify_admit_card(text) to anon, authenticated;
commit;
