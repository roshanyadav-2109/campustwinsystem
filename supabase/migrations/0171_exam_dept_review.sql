-- Exam department: fixes from the product + CTO review.
begin;
alter table public.exam_seat add column if not exists present boolean;
create table if not exists public.exam_incident (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id  bigint not null references public.exam_session(id) on delete cascade,
  exam_date   date not null,
  starts_at   time not null,
  student_id  bigint not null references public.student(id) on delete cascade,
  description text not null check (char_length(description) between 3 and 500),
  status      text not null default 'open' check (status in ('open', 'cleared', 'penalised')),
  reported_by bigint references public.staff(id) on delete set null,
  decided_by  bigint references public.staff(id) on delete set null,
  decision    text check (decision is null or char_length(decision) <= 300),
  created_at  timestamptz not null default now()
);
alter table public.exam_incident enable row level security;
drop policy if exists tenant_isolation on public.exam_incident;
create policy tenant_isolation on public.exam_incident as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists ei_read on public.exam_incident;
create policy ei_read on public.exam_incident for select to authenticated using ((select app.is_exams()) or reported_by = (select app.my_staff_id()));
revoke all on public.exam_incident from anon, authenticated;
grant select on public.exam_incident to authenticated;
grant all on public.exam_incident to service_role;
create index if not exists idx_exam_script_open on public.exam_script (school_id) where status <> 'decoded';

create or replace function public.generate_seating(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); sl record; n int := 0; v_need int; v_cap int;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can plan seating'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  delete from public.exam_duty where session_id = p_session;
  delete from public.exam_seat where session_id = p_session;
  for sl in select distinct exam_date, starts_at from public.exam_paper where session_id = p_session order by 1, 2 loop
    with c as (select x.student_id, x.sort_key, split_part(x.sort_key, '-', 1) || '-' || split_part(x.sort_key, '-', 2) grp
               from public.slot_candidates(p_session, sl.exam_date, sl.starts_at) x),
    c2 as (select c.*, row_number() over (partition by c.grp order by c.sort_key) rn from c),
    ordered as (select c2.student_id, row_number() over (order by c2.rn, c2.grp, c2.student_id) k from c2),
    rooms as (select r.id, coalesce(sum(r.capacity) over (order by r.sort, r.name rows between unbounded preceding and 1 preceding), 0) lo, sum(r.capacity) over (order by r.sort, r.name) hi
              from public.exam_room r where r.school_id = v_school and r.active
                and not exists (select 1 from public.exam_seat o where o.room_id = r.id and o.exam_date = sl.exam_date and o.starts_at = sl.starts_at and o.session_id <> p_session)),
    ins as (insert into public.exam_seat (school_id, session_id, exam_date, starts_at, student_id, room_id, seat_no)
            select v_school, p_session, sl.exam_date, sl.starts_at, o.student_id, r.id, (o.k - r.lo)::int
            from ordered o join rooms r on o.k > r.lo and o.k <= r.hi returning 1)
    select (select count(*) from ins), (select count(*) from c), (select coalesce(max(hi), 0) from rooms) into v_cap, v_need, n;
    if v_cap < v_need then
      raise exception 'On % at % there are % candidates but the free rooms seat %', to_char(sl.exam_date, 'DD Mon'), to_char(sl.starts_at, 'HH24:MI'), v_need, n;
    end if;
  end loop;
  select count(*) into n from public.exam_seat where session_id = p_session;
  return n;
end $$;

drop function if exists public.assign_duties(bigint, int);
create function public.assign_duties(p_session bigint, p_per_room int default 1) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_pool bigint[]; n int; v_short text; v_per int := least(greatest(coalesce(p_per_room, 1), 1), 4);
begin
  if not app.is_exams() then raise exception 'Only the exam cell can assign duties'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  -- exam-centre staff first, then teachers; fewest duties this year first
  select array_agg(x.id order by x.pri, x.load, x.id) into v_pool from (
    select st.id, case when exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)) then 0 else 1 end pri,
      (select count(*) from public.exam_duty d where d.staff_id = st.id) load
    from public.staff st where st.school_id = v_school and st.role in ('subject_teacher', 'class_teacher')) x;
  if coalesce(cardinality(v_pool), 0) = 0 then raise exception 'There are no teachers to assign'; end if;
  delete from public.exam_duty where session_id = p_session;
  select string_agg(to_char(s.exam_date, 'DD Mon') || ' ' || to_char(s.starts_at, 'HH24:MI'), ', ') into v_short
    from (select exam_date, starts_at, count(distinct room_id) * v_per need from public.exam_seat where session_id = p_session group by 1, 2) s
   where s.need > cardinality(v_pool);
  if v_short is not null then raise exception 'Not enough teachers for % invigilators per room on: %', v_per, v_short; end if;
  with need as (select x.exam_date, x.starts_at, x.room_id, g.k from (select distinct exam_date, starts_at, room_id from public.exam_seat where session_id = p_session) x
                cross join generate_series(1, v_per) g(k)),
  numbered as (select need.*, row_number() over (partition by need.exam_date, need.starts_at order by need.room_id, need.k) - 1 + (dense_rank() over (order by need.exam_date, need.starts_at) - 1) * 7 pos from need),
  ins as (insert into public.exam_duty (school_id, session_id, exam_date, starts_at, room_id, staff_id)
          select v_school, p_session, nb.exam_date, nb.starts_at, nb.room_id, v_pool[(nb.pos % cardinality(v_pool)) + 1]
          from numbered nb
          where not exists (select 1 from public.exam_duty o where o.staff_id = v_pool[(nb.pos % cardinality(v_pool)) + 1] and o.exam_date = nb.exam_date and o.starts_at = nb.starts_at)
          on conflict do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.assign_duties(bigint, int) from public, anon;
grant execute on function public.assign_duties(bigint, int) to authenticated;

create or replace function public.my_room_roster(p_session bigint, p_date date, p_start time)
returns table (seat_id bigint, seat_no int, student_name text, admission_no text, room text, present boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, x.seat_no, st.full_name, st.admission_no, r.name, x.present
  from public.exam_seat x join public.student st on st.id = x.student_id join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.exam_date = p_date and x.starts_at = p_start and x.school_id = public.current_school_id()
    and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()))
  order by r.name, x.seat_no;
$$;
grant execute on function public.my_room_roster(bigint, date, time) to authenticated;

create or replace function public.mark_exam_attendance(p_seats bigint[], p_present boolean[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if cardinality(p_seats) <> cardinality(p_present) then raise exception 'The lists do not line up'; end if;
  update public.exam_seat x set present = y.present
  from unnest(p_seats, p_present) as y(id, present)
  where x.id = y.id and x.school_id = public.current_school_id()
    and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_exam_attendance(bigint[], boolean[]) from public, anon;
grant execute on function public.mark_exam_attendance(bigint[], boolean[]) to authenticated;

create or replace function public.report_incident(p_seat bigint, p_description text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare x public.exam_seat; v_id bigint;
begin
  select * into x from public.exam_seat where id = p_seat and school_id = public.current_school_id();
  if x.id is null then raise exception 'Unknown seat'; end if;
  if not (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id())) then
    raise exception 'Only the room invigilator or the exam cell can report this';
  end if;
  insert into public.exam_incident (school_id, session_id, exam_date, starts_at, student_id, description, reported_by)
  values (x.school_id, x.session_id, x.exam_date, x.starts_at, x.student_id, left(trim(p_description), 500), app.my_staff_id()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.report_incident(bigint, text) from public, anon;
grant execute on function public.report_incident(bigint, text) to authenticated;

create or replace function public.decide_incident(p_id bigint, p_status text, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_publish_results() then raise exception 'Malpractice is decided by the Controller of Examinations'; end if;
  if p_status not in ('cleared', 'penalised') then raise exception 'Clear it or record the penalty'; end if;
  update public.exam_incident set status = p_status, decision = left(trim(coalesce(p_decision, '')), 300), decided_by = app.my_staff_id()
   where id = p_id and school_id = public.current_school_id() and status = 'open';
  if not found then raise exception 'This report is already decided'; end if;
end $$;
revoke all on function public.decide_incident(bigint, text, text) from public, anon;
grant execute on function public.decide_incident(bigint, text, text) to authenticated;

-- seats for hall tickets: the exam cell for an exam, a family for their own student
create or replace function public.session_seats(p_session bigint, p_student bigint default null)
returns table (student_id bigint, exam_date date, starts_at time, room text, seat_no int)
language sql stable security definer set search_path = '' as $$
  select x.student_id, x.exam_date, x.starts_at, r.name, x.seat_no
  from public.exam_seat x join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.school_id = public.current_school_id() and (p_student is null or x.student_id = p_student)
    and (app.is_exams() or coalesce(app.is_admin_scope(), false) or (p_student is not null and app.owns_student(p_student))
         or exists (select 1 from public.student_enrollment e where e.student_id = x.student_id and e.status = 'active' and app.ct_of_section(e.section_id, null)));
$$;
grant execute on function public.session_seats(bigint, bigint) to authenticated;

create or replace function public.generate_scripts(p_paper bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; p public.exam_paper;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can code answer scripts'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  insert into public.exam_script (school_id, paper_id, student_id, code, is_absent, status)
  select p.school_id, p_paper, c.student_id, upper(substr(md5(gen_random_uuid()::text), 1, 12)),
         coalesce(st.present = false, false), case when st.present = false then 'marked' else 'pending' end
  from (select student_id from public.paper_candidates(p_paper) order by random()) c
  left join public.exam_seat st on st.session_id = p.session_id and st.exam_date = p.exam_date and st.starts_at = p.starts_at and st.student_id = c.student_id
  on conflict (paper_id, student_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

drop function if exists public.allot_evaluators(bigint, bigint[]);
create function public.allot_evaluators(p_paper bigint, p_staff bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; v_bad text; p public.exam_paper;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can allot scripts'; end if;
  if coalesce(cardinality(p_staff), 0) = 0 then raise exception 'Choose the evaluators'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if exists (select 1 from unnest(p_staff) x where not exists (select 1 from public.staff s where s.id = x and s.school_id = p.school_id)) then raise exception 'Unknown staff member'; end if;
  -- not the confidential section itself, and not the teacher of these candidates for this subject
  select string_agg(distinct s.full_name, ', ') into v_bad from unnest(p_staff) x join public.staff s on s.id = x
   where exists (select 1 from public.staff_position sp join public.position_title t on t.id = sp.title_id where sp.staff_id = x and t.access_type in ('confidential', 'exams_head') and (sp.ends_on is null or sp.ends_on >= current_date))
      or exists (select 1 from public.teacher_allotment ta join public.exam_script es on es.paper_id = p_paper
                 join public.student_enrollment e on e.student_id = es.student_id and e.section_id = ta.section_id and e.status = 'active'
                 where ta.staff_id = x and ta.subject_id = p.subject_id);
  if v_bad is not null then raise exception 'Cannot evaluate this paper (confidential section, or teaches these candidates): %', v_bad; end if;
  update public.exam_script x set evaluator_id = p_staff[((y.k - 1) % cardinality(p_staff)) + 1]
  from (select id, row_number() over (order by code) k from public.exam_script where paper_id = p_paper and status = 'pending') y
  where x.id = y.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.allot_evaluators(bigint, bigint[]) from public, anon;
grant execute on function public.allot_evaluators(bigint, bigint[]) to authenticated;

create or replace function public.my_scripts()
returns table (id bigint, code text, subject text, exam_date date, max_marks numeric, marks numeric, is_absent boolean, status text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.code, sb.name, p.exam_date, p.max_marks, x.marks, x.is_absent, x.status
  from public.exam_script x join public.exam_paper p on p.id = x.paper_id join public.subject sb on sb.id = p.subject_id
  where x.evaluator_id = app.my_staff_id() and x.school_id = public.current_school_id() and x.status <> 'decoded'
  order by p.exam_date, sb.name, x.code;
$$;

create or replace function public.decode_scripts(p_paper bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare p public.exam_paper; v_done bigint[]; v_left int;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can decode scripts'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if p.class_id is not null then
    with w as (
      insert into public.mark (assessment_id, student_id, marks_obtained, is_absent, is_exempt, school_id, entered_by)
      select a.id, x.student_id, case when x.is_absent then null else round(x.marks, 2) end, x.is_absent, false, p.school_id, app.my_staff_id()
      from public.exam_script x
      join public.exam_session s on s.id = p.session_id
      join lateral (select e.section_id from public.student_enrollment e where e.student_id = x.student_id and e.academic_year_id = s.academic_year_id
                    order by (e.status = 'active') desc limit 1) e on true
      join public.assessment a on a.exam_paper_id = p.id and a.section_id = e.section_id
      where x.paper_id = p.id and x.status = 'marked'
      on conflict (assessment_id, student_id) do update set marks_obtained = excluded.marks_obtained, is_absent = excluded.is_absent, is_exempt = false, entered_by = excluded.entered_by
      returning student_id)
    select coalesce(array_agg(student_id), '{}') into v_done from w;
  else
    with w as (
      update public.supp_registration r set ese_marks = case when x.is_absent then null else round(least(x.marks / nullif(p.max_marks, 0) * r.ese_max, r.ese_max), 2) end, is_absent = x.is_absent
      from public.exam_script x join public.subject sb on sb.id = p.subject_id
      where x.paper_id = p.id and x.status = 'marked' and r.session_id = p.session_id and r.student_id = x.student_id and r.course_id = sb.course_id and r.status = 'registered'
      returning r.student_id)
    select coalesce(array_agg(student_id), '{}') into v_done from w;
  end if;
  update public.exam_script set status = 'decoded', decoded_at = now() where paper_id = p.id and status = 'marked' and student_id = any(v_done);
  select count(*) into v_left from public.exam_script where paper_id = p.id and status = 'marked';
  if v_left > 0 then raise exception 'Decoded %; % could not be written (no marks column for the student, or the result is already published)', cardinality(v_done), v_left; end if;
  return cardinality(v_done);
end $$;

create or replace function public.guard_signed_cia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record; v_sid bigint := coalesce(new.student_id, old.student_id);
begin
  select x.section_id, x.subject_id, x.term, x.academic_year_id, x.assessment_type_id, x.school_id into a from public.assessment x where x.id = coalesce(new.assessment_id, old.assessment_id);
  if a.section_id is null or not public.is_higher_ed(a.school_id) then return coalesce(new, old); end if;
  -- end-semester marks are not internal marks
  if exists (select 1 from public.eval_component ec join public.eval_scheme es on es.id = ec.scheme_id where es.school_id = a.school_id and ec.part = 'ese' and ec.assessment_type_id = a.assessment_type_id) then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.cia_signoff cs join public.semester s on s.id = cs.semester_id
             where cs.section_id = a.section_id and cs.subject_id = a.subject_id and s.academic_year_id = a.academic_year_id
               and (case s.kind when 'odd' then 1 when 'even' then 2 end) = a.term) then
    raise exception 'Internal marks for this course are signed off; the Head of Department removes the sign-off first';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_signed_cia on public.mark;
create trigger trg_guard_signed_cia before insert or update or delete on public.mark for each row execute function public.guard_signed_cia();

create or replace function public.check_cia_signoff(p_semester bigint, p_section bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_missing text;
begin
  if not (select require_cia_signoff from public.school where id = public.current_school_id()) then return; end if;
  select string_agg(distinct sb.name, ', ') into v_missing
  from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.semester s on s.id = r.semester_id
  join public.subject sb on sb.course_id = pc.course_id and sb.school_id = s.school_id
  join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = s.academic_year_id and e.section_id = p_section and e.status = 'active'
  where r.semester_id = p_semester and r.status <> 'dropped'
    and not exists (select 1 from public.cia_signoff cs where cs.semester_id = p_semester and cs.section_id = p_section and cs.subject_id = sb.id);
  if v_missing is not null then raise exception 'Internal marks are not signed off yet for: %', left(v_missing, 200); end if;
end $$;

create or replace function public.result_hold_reason(p_student bigint, p_semester bigint, p_fees boolean default true) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_manual text; v_short text; sc public.school; s public.semester; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select sr.withheld_reason into v_manual from public.semester_result sr where sr.student_id = p_student and sr.semester_id = p_semester;
  if v_manual is not null then return v_manual; end if;
  if exists (select 1 from public.exam_incident i join public.exam_session es on es.id = i.session_id join public.semester sm on sm.id = p_semester
             where i.student_id = p_student and i.status = 'open' and es.academic_year_id = sm.academic_year_id
               and (es.term = case sm.kind when 'odd' then 1 when 'even' then 2 end or es.for_semester_id = sm.id)) then
    return 'Malpractice report under inquiry';
  end if;
  select * into s from public.semester where id = p_semester;
  select * into sc from public.school where id = s.school_id;
  v_short := public.attendance_shortage(p_student, p_semester);
  if v_short is not null then return 'Attendance below ' || sc.attendance_minimum || '% in ' || v_short; end if;
  if p_fees and sc.hold_results_fees and public.overdue_fees(p_student, least(v_today, s.ends_on + 1)) > 0
     and not public.fee_relaxed(p_student, v_today) then return 'Fees overdue'; end if;
  return null;
end $$;
commit;
notify pgrst, 'reload schema';
