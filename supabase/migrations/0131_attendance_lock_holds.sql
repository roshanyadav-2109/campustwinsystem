-- Colleges and universities: attendance lock, automatic holds, relaxations.
--
-- Lock. The institution (administration or exam cell) chooses how lecture
-- attendance locks:
--   daily  : a day can be marked or corrected up to N days later, then locks;
--   cutoff : free until the semester's attendance cut-off date, set by the
--            exam cell before exams; after it, everything up to the cut-off
--            is frozen and that is the attendance used for hall tickets;
--   both   : daily lock, plus the final freeze at the cut-off.
-- A locked day opens only through an approved unlock request. Every change
-- to an already-marked lecture is logged.
--
-- Holds. Worked out live, never stored: hall tickets and results are held for
-- an attendance shortage that is not relaxed, and for overdue fees when the
-- institution chooses. Paying, or an approved relaxation, releases at once.
-- A hold the office puts on by hand stays until the office releases it.
--
-- Relaxations. Attendance relaxation, fee extension and unlock requests pass
-- through an approval chain the institution sets (for example class teacher,
-- then principal). Attendance below the floor cannot be relaxed. Students and
-- parents can apply themselves.
begin;
alter table public.school add column if not exists attendance_lock_mode text not null default 'daily' check (attendance_lock_mode in ('none', 'daily', 'cutoff', 'both'));
alter table public.school add column if not exists attendance_edit_days smallint not null default 3 check (attendance_edit_days between 0 and 60);
alter table public.school add column if not exists condone_floor numeric(5,2) check (condone_floor between 0 and 100);
alter table public.school add column if not exists hold_results_fees boolean not null default false;
alter table public.school add column if not exists relax_chain jsonb not null default '{"attendance": ["advisor", "head"], "fees": ["office"], "unlock": ["head"]}'::jsonb;
alter table public.semester add column if not exists attendance_cutoff date;

create or replace function public.relax_chain_ok(c jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(c) = 'object'
     and (select bool_and(k in ('attendance', 'fees', 'unlock')
                          and jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 4
                          and (select bool_and(x in ('advisor', 'head', 'office')) from jsonb_array_elements_text(v) x))
          from jsonb_each(c) e(k, v));
$$;
alter table public.school drop constraint if exists school_relax_chain_ok;
alter table public.school add constraint school_relax_chain_ok check (public.relax_chain_ok(relax_chain));

-- ---------- requests ----------
create table if not exists public.relaxation_request (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  kind         text not null check (kind in ('attendance', 'fees', 'unlock')),
  semester_id  bigint not null references public.semester(id) on delete cascade,
  student_id   bigint references public.student(id) on delete cascade,
  subject_id   bigint references public.subject(id) on delete cascade,
  section_id   bigint references public.section(id) on delete cascade,
  on_date      date,
  until        date,
  reason       text not null check (char_length(reason) between 3 and 300),
  chain        text[] not null,
  step         smallint not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  check ((kind = 'unlock') = (section_id is not null and subject_id is not null and on_date is not null and student_id is null)),
  check (kind = 'unlock' or student_id is not null),
  check (kind <> 'fees' or until is not null)
);
create index if not exists idx_relax_school_status on public.relaxation_request (school_id, status);
create unique index if not exists uq_relax_pending on public.relaxation_request (kind, semester_id, coalesce(student_id, 0), coalesce(subject_id, 0), coalesce(section_id, 0), coalesce(on_date, '1900-01-01'))
  where status = 'pending';
create table if not exists public.relaxation_step (
  id          bigint generated always as identity primary key,
  school_id   bigint not null references public.school(id) on delete cascade,
  request_id  bigint not null references public.relaxation_request(id) on delete cascade,
  step_no     smallint not null,
  as_type     text not null,
  staff_id    bigint references public.staff(id) on delete set null,
  decision    text not null check (decision in ('approved', 'rejected')),
  note        text check (note is null or char_length(note) <= 300),
  at          timestamptz not null default now()
);
create table if not exists public.attendance_change_log (
  id          bigint generated always as identity primary key,
  school_id   bigint not null references public.school(id) on delete cascade,
  section_id  bigint not null, subject_id bigint not null, on_date date not null, period smallint not null,
  changed_by  bigint references public.staff(id) on delete set null,
  old_absent  bigint[] not null, new_absent bigint[] not null,
  at          timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['relaxation_request', 'relaxation_step', 'attendance_change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists rr_read on public.relaxation_request;
create policy rr_read on public.relaxation_request for select to authenticated using ((select app.my_staff_id()) is not null or (student_id is not null and app.owns_student(student_id)));
drop policy if exists rs_read on public.relaxation_step;
create policy rs_read on public.relaxation_step for select to authenticated
  using ((select app.my_staff_id()) is not null or exists (select 1 from public.relaxation_request r where r.id = request_id and r.student_id is not null and app.owns_student(r.student_id)));
drop policy if exists acl_read on public.attendance_change_log;
create policy acl_read on public.attendance_change_log for select to authenticated using ((select app.is_admin_scope()));

-- ---------- helpers ----------
-- the student's section in the semester's year
create or replace function public.section_in_semester(p_student bigint, p_semester bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select e.section_id from public.student_enrollment e join public.semester s on s.id = p_semester
  where e.student_id = p_student and e.academic_year_id = s.academic_year_id order by (e.status = 'active') desc limit 1;
$$;

-- per-course attendance for a semester, up to the cut-off when there is one
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
       and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = p_semester and cd.student_id = p_student and cd.subject_id = sb.id)) x;
$$;

create or replace function public.overdue_fees(p_student bigint, p_before date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) from public.fee_invoice i
  where i.student_id = p_student and i.status in ('due', 'part') and i.due_date < p_before;
$$;

create or replace function public.fee_relaxed(p_student bigint, p_on date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.relaxation_request r where r.kind = 'fees' and r.student_id = p_student and r.status = 'approved' and r.until >= p_on);
$$;

-- why a published result is held back (null = visible). Internal: no caller check.
create or replace function public.result_hold_reason(p_student bigint, p_semester bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_manual text; v_short text; v_school public.school; v_min numeric;
begin
  select sr.withheld_reason into v_manual from public.semester_result sr where sr.student_id = p_student and sr.semester_id = p_semester;
  if v_manual is not null then return v_manual; end if;
  select sc.* into v_school from public.semester s join public.school sc on sc.id = s.school_id where s.id = p_semester;
  v_short := public.attendance_shortage(p_student, p_semester);
  if v_short is not null then return 'Attendance below ' || v_school.attendance_minimum || '% in ' || v_short; end if;
  if v_school.hold_results_fees and public.overdue_fees(p_student, (now() at time zone 'Asia/Kolkata')::date) > 0
     and not public.fee_relaxed(p_student, (now() at time zone 'Asia/Kolkata')::date) then return 'Fees overdue'; end if;
  return null;
end $$;
revoke all on function public.result_hold_reason(bigint, bigint) from public, anon, authenticated;
-- for users: staff, or the student's own family
create or replace function public.result_hold(p_student bigint, p_semester bigint) returns text
language sql stable security definer set search_path = '' as $$
  select case when app.my_staff_id() is not null or app.owns_student(p_student) then public.result_hold_reason(p_student, p_semester) end;
$$;
revoke all on function public.result_hold(bigint, bigint) from public, anon;
grant execute on function public.result_hold(bigint, bigint) to authenticated;

-- results: students and parents see them only when nothing holds them back
drop policy if exists srs_read on public.semester_result;
create policy srs_read on public.semester_result for select to authenticated
  using ((select app.my_staff_id()) is not null or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));
drop policy if exists crs_read on public.course_result;
create policy crs_read on public.course_result for select to authenticated
  using ((select app.my_staff_id()) is not null or (app.owns_student(student_id) and public.result_hold(student_id, semester_id) is null));
-- holds put on at publishing by 0130 are now worked out live
update public.semester_result set withheld_reason = null where withheld_reason like 'Attendance below%';

create or replace function public.verify_grade_card(p_token text)
returns table (valid boolean, student_name text, programme text, semester_no smallint, sgpa numeric, cgpa numeric, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select st.status <> 'left', st.full_name,
    (select p.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
      join public.semester s2 on s2.academic_year_id = e.academic_year_id where e.student_id = st.id and s2.id = sr.semester_id limit 1),
    sr.semester_no, sr.sgpa, sr.cgpa, sc.name, (sr.published_at at time zone 'Asia/Kolkata')::date
  from public.semester_result sr join public.student st on st.id = sr.student_id join public.school sc on sc.id = sr.school_id
  where sr.verify_token = p_token and length(p_token) between 20 and 64 and public.result_hold_reason(sr.student_id, sr.semester_id) is null;
$$;

-- ---------- lock ----------
-- why a lecture day cannot be marked now (null = open)
create or replace function public.lecture_lock_reason(p_section bigint, p_subject bigint, p_date date) returns text
language plpgsql stable security definer set search_path = '' as $$
declare sc public.school; s public.semester; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into sc from public.school where id = public.current_school_id();
  select * into s from public.semester where school_id = sc.id and is_current;
  if exists (select 1 from public.relaxation_request r where r.kind = 'unlock' and r.status = 'approved' and r.section_id = p_section and r.subject_id = p_subject
               and r.on_date = p_date and coalesce(r.until, r.decided_at::date + 2) >= v_today) then return null; end if;
  if sc.attendance_lock_mode in ('cutoff', 'both') and s.attendance_cutoff is not null and v_today > s.attendance_cutoff and p_date <= s.attendance_cutoff then
    return 'Attendance up to ' || to_char(s.attendance_cutoff, 'DD Mon YYYY') || ' is frozen for exams. Ask for it to be unlocked.';
  end if;
  if sc.attendance_lock_mode in ('daily', 'both') and p_date < v_today - sc.attendance_edit_days then
    return 'Attendance locks ' || sc.attendance_edit_days || ' days after the lecture. Ask for this day to be unlocked.';
  end if;
  return null;
end $$;
grant execute on function public.lecture_lock_reason(bigint, bigint, date) to authenticated;

create or replace function public.mark_lecture(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_lock text; v_old bigint[]; v_had boolean;
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school)
     or not exists (select 1 from public.subject where id = p_subject and school_id = v_school) then raise exception 'Unknown section or subject'; end if;
  if not (coalesce(app.is_office(), false) or app.ct_of_section(p_section, v_year)
          or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = v_year)) then
    raise exception 'Only the teacher of this course can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  v_lock := public.lecture_lock_reason(p_section, p_subject, p_date);
  if v_lock is not null then raise exception '%', v_lock; end if;
  select count(*) > 0, coalesce(array_agg(student_id order by student_id) filter (where status = 'absent'), '{}') into v_had, v_old
    from public.attendance_record where section_id = p_section and subject_id = p_subject and on_date = p_date and period = p_period;
  delete from public.attendance_record where section_id = p_section and subject_id = p_subject and on_date = p_date and period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id)
  select e.student_id, p_section, v_year, p_date, p_period, p_subject,
         (case when e.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end)::public.attendance_status, app.my_staff_id(), v_school
  from public.student_enrollment e where e.section_id = p_section and e.academic_year_id = v_year and e.status = 'active';
  get diagnostics n = row_count;
  if v_had and v_old is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_absent, '{}')) x) then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent)
    values (v_school, p_section, p_subject, p_date, p_period, app.my_staff_id(), v_old, coalesce(p_absent, '{}'));
  end if;
  return n;
end $$;

-- ---------- requests ----------
create or replace function public.request_relaxation(p_kind text, p_student bigint, p_subject bigint, p_section bigint, p_date date, p_until date, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_id bigint; v_pct numeric; v_chain text[];
begin
  select * into sc from public.school where id = v_school;
  if not public.is_higher_ed(v_school) then raise exception 'For colleges and universities'; end if;
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then raise exception 'No current semester'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  select array_agg(x) into v_chain from jsonb_array_elements_text(coalesce(sc.relax_chain -> p_kind, '["head"]'::jsonb)) x;
  if p_kind = 'unlock' then
    if not (coalesce(app.is_office(), false) or app.ct_of_section(p_section, s.academic_year_id)
            or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
      raise exception 'Only the teacher of this course can ask';
    end if;
    if public.lecture_lock_reason(p_section, p_subject, p_date) is null then raise exception 'This day is not locked'; end if;
    insert into public.relaxation_request (kind, semester_id, subject_id, section_id, on_date, until, reason, chain)
    values ('unlock', s.id, p_subject, p_section, p_date, null, left(trim(p_reason), 300), v_chain) returning id into v_id;
    return v_id;
  end if;
  if p_kind not in ('attendance', 'fees') then raise exception 'Unknown request'; end if;
  if not (app.my_staff_id() is not null or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  if public.section_in_semester(p_student, s.id) is null then raise exception 'Unknown student'; end if;
  if p_kind = 'attendance' then
    if p_subject is null then raise exception 'Choose the course'; end if;
    select round(100.0 * count(*) filter (where a.status in ('present', 'late')) / nullif(count(*), 0), 1) into v_pct
      from public.attendance_record a where a.student_id = p_student and a.subject_id = p_subject and a.period is not null
       and a.on_date between s.starts_on and coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on);
    if v_pct is null or v_pct >= sc.attendance_minimum then raise exception 'Attendance in this course is not short'; end if;
    if sc.condone_floor is not null and v_pct < sc.condone_floor then
      raise exception 'Attendance is % %%, below % %%: it cannot be relaxed', v_pct, sc.condone_floor;
    end if;
  else
    if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date or p_until > (now() at time zone 'Asia/Kolkata')::date + 120 then
      raise exception 'Give the date by which the fees will be paid (within 120 days)';
    end if;
  end if;
  insert into public.relaxation_request (kind, semester_id, student_id, subject_id, until, reason, chain)
  values (p_kind, s.id, p_student, case when p_kind = 'attendance' then p_subject end, case when p_kind = 'fees' then p_until end, left(trim(p_reason), 300), v_chain)
  returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting for approval';
end $$;
revoke all on function public.request_relaxation(text, bigint, bigint, bigint, date, date, text) from public, anon;
grant execute on function public.request_relaxation(text, bigint, bigint, bigint, date, date, text) to authenticated;

-- may the caller decide the request's current step?
create or replace function public.relax_can_act(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; t text; v_year bigint; v_sec bigint;
begin
  select * into r from public.relaxation_request where id = p_id and school_id = public.current_school_id();
  if r.id is null or r.status <> 'pending' then return false; end if;
  if coalesce(app.is_principal(), false) then return true; end if;
  t := r.chain[r.step + 1];
  select academic_year_id into v_year from public.semester where id = r.semester_id;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  return case t when 'advisor' then coalesce(app.ct_of_section(v_sec, v_year), false)
                when 'office' then coalesce(app.is_office(), false)
                else false end;
end $$;
grant execute on function public.relax_can_act(bigint) to authenticated;

create or replace function public.decide_relaxation(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request; v_as text;
begin
  if not public.relax_can_act(p_id) then raise exception 'This request is not waiting for you'; end if;
  select * into r from public.relaxation_request where id = p_id for update;
  v_as := case when r.chain[r.step + 1] = 'head' or not coalesce(app.is_principal(), false) then r.chain[r.step + 1] else 'head' end;
  insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
  values (r.school_id, r.id, r.step + 1, v_as, app.my_staff_id(), case when p_approve then 'approved' else 'rejected' end, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  if not p_approve then
    update public.relaxation_request set status = 'rejected', decided_at = now() where id = r.id;
    return 'rejected';
  end if;
  -- the principal approving closes the chain; otherwise move to the next step
  if coalesce(app.is_principal(), false) or r.step + 1 >= array_length(r.chain, 1) then
    update public.relaxation_request set status = 'approved', step = array_length(r.chain, 1), decided_at = now() where id = r.id;
    if r.kind = 'attendance' then
      insert into public.attendance_condonation (school_id, semester_id, student_id, subject_id, reason, approved_by)
      values (r.school_id, r.semester_id, r.student_id, r.subject_id, left(r.reason, 200), app.my_staff_id())
      on conflict (semester_id, student_id, subject_id) do nothing;
    end if;
    return 'approved';
  end if;
  update public.relaxation_request set step = r.step + 1 where id = r.id;
  return 'next';
end $$;
revoke all on function public.decide_relaxation(bigint, boolean, text) from public, anon;
grant execute on function public.decide_relaxation(bigint, boolean, text) to authenticated;

create or replace function public.cancel_relaxation(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.relaxation_request set status = 'cancelled', decided_at = now()
   where id = p_id and status = 'pending' and school_id = public.current_school_id() and (requested_by = auth.uid() or coalesce(app.is_office(), false));
  if not found then raise exception 'Only the person who asked can cancel'; end if;
end $$;
grant execute on function public.cancel_relaxation(bigint) to authenticated;

-- ---------- hall tickets (0129) with the shared helpers and fee extensions ----------
create or replace function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text, subject_ids bigint[])
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date; v_he boolean; v_sem public.semester; v_min numeric;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not app.is_admin_scope() and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  v_he := public.is_higher_ed(v_school);
  select * into v_sem from public.semester where school_id = v_school and is_current;
  select attendance_minimum into v_min from public.school where id = v_school;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, e.roll_no::int roll, c.name || '-' || sec.name cls, st.photo_path, ac.verify_token tok,
      case when v_s.withhold_fee_dues and not public.fee_relaxed(st.id, coalesce(v_first, current_date)) then public.overdue_fees(st.id, coalesce(v_first, current_date)) else 0 end bal,
      case when v_he and v_sem.id is not null then (
        select array_agg(distinct sb.id) from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
        join public.subject sb on sb.course_id = pc.course_id and sb.school_id = v_school
        where r.semester_id = v_sem.id and r.student_id = st.id and r.status <> 'dropped') end subj,
      case when v_he and v_sem.id is not null then public.attendance_shortage(st.id, v_sem.id) end short
    from public.student_enrollment e
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
    where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student))
  select b.sid, b.full_name, b.admission_no, b.roll, b.cls, b.photo_path,
    b.bal > 0 or b.short is not null,
    case when b.short is not null then 'Attendance below ' || v_min || '% in ' || b.short
         when b.bal > 0 then (case when app.is_office() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when b.bal > 0 or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;

-- ---------- publishing (0130) without storing automatic holds ----------
create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int := 0; r record; v_sem public.semester; v_fail_counts boolean;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can publish results'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  for r in
    select c.student_id, bool_and(c.status in ('pass', 'fail', 'absent')) complete,
           exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = c.student_id) done
    from public.compute_course_results(p_semester, p_section) c group by c.student_id
  loop
    continue when not r.complete;
    continue when r.done and coalesce(trim(p_revise_reason), '') = '';
    if r.done then
      insert into public.course_result_revision (school_id, revised_by, reason, old)
      select v_school, app.my_staff_id(), left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1;
      delete from public.course_result where semester_id = p_semester and student_id = r.student_id and attempt = 1;
    end if;
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
    from public.compute_course_results(p_semester, p_section) c where c.student_id = r.student_id;
    select coalesce(es.fail_counts_in_gpa, true) into v_fail_counts
      from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
      join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
     where e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id limit 1;
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(v_fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(v_fail_counts, true)), 0), 2),
      null, count(*) filter (where not cr.passed), app.my_staff_id()
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by, published_at = now();
    perform public.recompute_cgpa(r.student_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.publish_semester_results(bigint, bigint, text) from public, anon;
grant execute on function public.publish_semester_results(bigint, bigint, text) to authenticated;

-- the office (or principal) sets the lock and hold rules
create or replace function public.set_attendance_rules(p_mode text, p_days int, p_minimum numeric, p_floor numeric, p_hold_fees boolean, p_chain jsonb, p_cutoff date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can change these rules'; end if;
  if p_floor is not null and p_floor > p_minimum then raise exception 'The floor must be below the minimum attendance'; end if;
  update public.school set attendance_lock_mode = p_mode, attendance_edit_days = p_days, attendance_minimum = p_minimum, condone_floor = p_floor,
    hold_results_fees = p_hold_fees, relax_chain = p_chain where id = v_school;
  update public.semester set attendance_cutoff = p_cutoff where school_id = v_school and is_current;
end $$;
revoke all on function public.set_attendance_rules(text, int, numeric, numeric, boolean, jsonb, date) from public, anon;
grant execute on function public.set_attendance_rules(text, int, numeric, numeric, boolean, jsonb, date) to authenticated;
commit;
notify pgrst, 'reload schema';
