-- Exam department, part 1 (colleges and universities):
--   exam_cell_overview: the exam department's dashboard in one call
--   exam rooms, seating plans per exam slot, invigilation duties
begin;
-- coded answer scripts (used in 0166; created here because the dashboard counts them)
create table if not exists public.exam_script (
  id           bigint generated always as identity primary key,
  school_id    bigint not null references public.school(id) on delete cascade,
  paper_id     bigint not null references public.exam_paper(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  code         text not null,
  evaluator_id bigint references public.staff(id) on delete set null,
  marks        numeric(6,2) check (marks is null or marks >= 0),
  is_absent    boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'marked', 'decoded')),
  marked_at    timestamptz,
  decoded_at   timestamptz,
  unique (paper_id, student_id),
  unique (school_id, code)
);
create index if not exists idx_exam_script_evaluator on public.exam_script (evaluator_id, status);
alter table public.exam_script enable row level security;
drop policy if exists tenant_isolation on public.exam_script;
create policy tenant_isolation on public.exam_script as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
revoke all on public.exam_script from anon, authenticated;
grant all on public.exam_script to service_role;

-- ---------- rooms, seats, duties ----------
create table if not exists public.exam_room (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 40),
  capacity  int not null check (capacity between 1 and 1000),
  active    boolean not null default true,
  sort      int not null default 100,
  unique (school_id, name)
);
create table if not exists public.exam_seat (
  id         bigint generated always as identity primary key,
  school_id  bigint not null references public.school(id) on delete cascade,
  session_id bigint not null references public.exam_session(id) on delete cascade,
  exam_date  date not null,
  starts_at  time not null,
  student_id bigint not null references public.student(id) on delete cascade,
  room_id    bigint not null references public.exam_room(id) on delete cascade,
  seat_no    int not null,
  unique (session_id, exam_date, starts_at, student_id),
  unique (session_id, exam_date, starts_at, room_id, seat_no)
);
create table if not exists public.exam_duty (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id bigint not null references public.exam_session(id) on delete cascade,
  exam_date  date not null,
  starts_at  time not null,
  room_id    bigint not null references public.exam_room(id) on delete cascade,
  staff_id   bigint not null references public.staff(id) on delete cascade,
  unique (session_id, exam_date, starts_at, staff_id)
);
create index if not exists idx_exam_seat_slot on public.exam_seat (session_id, exam_date, starts_at, room_id);
create index if not exists idx_exam_duty_staff on public.exam_duty (staff_id, exam_date);
do $$ declare t text; begin
  foreach t in array array['exam_room', 'exam_seat', 'exam_duty'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists er_read on public.exam_room;
create policy er_read on public.exam_room for select to authenticated using ((select app.my_staff_id()) is not null);
drop policy if exists er_write on public.exam_room;
create policy er_write on public.exam_room for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams()));
grant select, insert, update, delete on public.exam_room to authenticated;
-- seats: the exam cell, and each student their own seat
drop policy if exists es_read on public.exam_seat;
create policy es_read on public.exam_seat for select to authenticated using ((select app.is_exams()) or app.owns_student(student_id));
revoke insert, update, delete on public.exam_seat from authenticated;
grant select on public.exam_seat to authenticated;
-- duties: staff see duties (their own and the plan); the exam cell changes them
drop policy if exists ed_read on public.exam_duty;
create policy ed_read on public.exam_duty for select to authenticated using ((select app.my_staff_id()) is not null);
drop policy if exists ed_write on public.exam_duty;
create policy ed_write on public.exam_duty for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams()));
grant select, insert, update, delete on public.exam_duty to authenticated;

-- the candidates of one exam slot (date and start time)
create or replace function public.slot_candidates(p_session bigint, p_date date, p_start time)
returns table (student_id bigint, sort_key text)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.exam_session where id = p_session and school_id = public.current_school_id()),
  papers as (select p.* from public.exam_paper p, s where p.session_id = s.id and p.exam_date = p_date and p.starts_at = p_start),
  cur as (select m.* from public.semester m, s where m.school_id = s.school_id and m.academic_year_id = s.academic_year_id
            and m.kind = case s.term when 1 then 'odd' when 2 then 'even' else m.kind end order by m.is_current desc limit 1)
  -- class papers: students of those classes (in colleges, only those registered for the course)
  select distinct e.student_id, c.name || '-' || sec.name || '-' || lpad(coalesce(e.roll_no, 0)::text, 4, '0')
  from papers p join s on true join public.section sec on sec.class_id = p.class_id join public.class c on c.id = sec.class_id
  join public.student_enrollment e on e.section_id = sec.id and e.academic_year_id = s.academic_year_id and e.status = 'active'
  where p.class_id is not null
    and (not public.is_higher_ed(s.school_id) or not exists (select 1 from cur)
         or exists (select 1 from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.subject sb on sb.id = p.subject_id
                    where r.student_id = e.student_id and r.semester_id = (select id from cur) and pc.course_id = sb.course_id and r.status <> 'dropped'))
  union
  -- course papers of supplementary and improvement exams: their registered candidates
  select distinct r.student_id, 'zz-' || st.admission_no
  from papers p join public.subject sb on sb.id = p.subject_id join public.supp_registration r on r.session_id = p.session_id and r.course_id = sb.course_id
  join public.student st on st.id = r.student_id
  where p.class_id is null;
$$;
revoke all on function public.slot_candidates(bigint, date, time) from public, anon, authenticated;

-- seat everyone for every slot of the exam, rooms in order, filled to capacity
create or replace function public.generate_seating(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_cap int; v_need int; sl record; n int := 0;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can plan seating'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  select coalesce(sum(capacity), 0) into v_cap from public.exam_room where school_id = v_school and active;
  if v_cap = 0 then raise exception 'Add exam rooms first'; end if;
  for sl in select distinct exam_date, starts_at from public.exam_paper where session_id = p_session order by 1, 2 loop
    select count(*) into v_need from public.slot_candidates(p_session, sl.exam_date, sl.starts_at);
    if v_need > v_cap then raise exception 'On % at % there are % candidates but rooms seat %', to_char(sl.exam_date, 'DD Mon'), to_char(sl.starts_at, 'HH24:MI'), v_need, v_cap; end if;
  end loop;
  delete from public.exam_seat where session_id = p_session;
  insert into public.exam_seat (school_id, session_id, exam_date, starts_at, student_id, room_id, seat_no)
  select v_school, p_session, x.exam_date, x.starts_at, x.student_id, r.id, (x.k - r.lo)::int
  from (
    select slt.exam_date, slt.starts_at, c.student_id, row_number() over (partition by slt.exam_date, slt.starts_at order by c.sort_key, c.student_id) k
    from (select distinct ep.exam_date, ep.starts_at from public.exam_paper ep where ep.session_id = p_session) slt
    cross join lateral public.slot_candidates(p_session, slt.exam_date, slt.starts_at) c) x
  join (select id, coalesce(sum(capacity) over (order by sort, name rows between unbounded preceding and 1 preceding), 0) lo,
               sum(capacity) over (order by sort, name) hi
        from public.exam_room where school_id = v_school and active) r on x.k > r.lo and x.k <= r.hi;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.generate_seating(bigint) from public, anon;
grant execute on function public.generate_seating(bigint) to authenticated;

-- invigilators for every room in use, in turn: exam-centre staff first, then teachers;
-- nobody twice in one slot, and the load spread evenly
create or replace function public.assign_duties(p_session bigint, p_per_room int default 1) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_pool bigint[]; n int := 0; sl record; rm record; i int := 0; k int; v_staff bigint;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can assign duties'; end if;
  select array_agg(id order by pri, id) into v_pool from (
    select distinct st.id, case when exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                             where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)) then 0 else 1 end pri
    from public.staff st where st.school_id = v_school and st.role in ('subject_teacher', 'class_teacher')) x;
  if coalesce(cardinality(v_pool), 0) = 0 then raise exception 'There are no teachers to assign'; end if;
  delete from public.exam_duty where session_id = p_session;
  for sl in select distinct exam_date, starts_at from public.exam_seat where session_id = p_session order by 1, 2 loop
    for rm in select distinct room_id from public.exam_seat where session_id = p_session and exam_date = sl.exam_date and starts_at = sl.starts_at loop
      for k in 1..greatest(1, p_per_room) loop
        -- the next person in the pool who is free in this slot
        for j in 0..cardinality(v_pool) - 1 loop
          v_staff := v_pool[((i + j) % cardinality(v_pool)) + 1];
          exit when not exists (select 1 from public.exam_duty d where d.session_id = p_session and d.exam_date = sl.exam_date and d.starts_at = sl.starts_at and d.staff_id = v_staff);
          v_staff := null;
        end loop;
        exit when v_staff is null;
        insert into public.exam_duty (school_id, session_id, exam_date, starts_at, room_id, staff_id) values (v_school, p_session, sl.exam_date, sl.starts_at, rm.room_id, v_staff);
        i := i + 1; n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.assign_duties(bigint, int) from public, anon;
grant execute on function public.assign_duties(bigint, int) to authenticated;

-- an invigilator's own duties
create or replace function public.my_duties()
returns table (session_name text, exam_date date, starts_at time, room text, candidates int)
language sql stable security definer set search_path = '' as $$
  select s.name, d.exam_date, d.starts_at, r.name,
    (select count(*)::int from public.exam_seat x where x.session_id = d.session_id and x.exam_date = d.exam_date and x.starts_at = d.starts_at and x.room_id = d.room_id)
  from public.exam_duty d join public.exam_session s on s.id = d.session_id join public.exam_room r on r.id = d.room_id
  where d.staff_id = app.my_staff_id() and d.exam_date >= (now() at time zone 'Asia/Kolkata')::date
  order by d.exam_date, d.starts_at;
$$;
grant execute on function public.my_duties() to authenticated;

-- the seating chart of a slot (exam cell)
create or replace function public.seating_chart(p_session bigint)
returns table (exam_date date, starts_at time, room text, seat_no int, student_name text, admission_no text, invigilators text)
language sql stable security definer set search_path = '' as $$
  select x.exam_date, x.starts_at, r.name, x.seat_no, st.full_name, st.admission_no,
    (select string_agg(s2.full_name, ', ') from public.exam_duty d join public.staff s2 on s2.id = d.staff_id
      where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id)
  from public.exam_seat x join public.exam_room r on r.id = x.room_id join public.student st on st.id = x.student_id
  where x.session_id = p_session and x.school_id = public.current_school_id() and app.is_exams()
  order by x.exam_date, x.starts_at, r.sort, r.name, x.seat_no;
$$;
grant execute on function public.seating_chart(bigint) to authenticated;
-- ---------- dashboard ----------
create or replace function public.exam_cell_overview() returns jsonb
language sql stable security definer set search_path = '' as $$
  with sc as (select public.current_school_id() id),
  yr as (select y.id from public.academic_year y, sc where y.school_id = sc.id and y.is_current),
  ses as (
    select s.id, s.name, s.kind, s.published_at is not null published,
      (select count(*) from public.exam_paper p where p.session_id = s.id) papers,
      (select count(*) from public.exam_admit_card a where a.session_id = s.id) tickets,
      (select count(*) from public.supp_registration r where r.session_id = s.id) candidates,
      (select count(*) from public.supp_registration r where r.session_id = s.id and r.status = 'registered' and r.ese_marks is null and not r.is_absent) marks_missing,
      (select count(*) from public.exam_seat st where st.session_id = s.id) seated
    from public.exam_session s, sc, yr where s.school_id = sc.id and s.academic_year_id = yr.id),
  sem as (
    select m.id, m.kind, m.starts_on,
      (select count(distinct r.student_id) from public.course_registration r where r.semester_id = m.id and r.status <> 'dropped') registered,
      (select count(*) from public.semester_result x where x.semester_id = m.id) published
    from public.semester m, sc, yr where m.school_id = sc.id and m.academic_year_id = yr.id and m.kind in ('odd', 'even'))
  select case when app.is_exams() or coalesce(app.is_admin_scope(), false) then jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(to_jsonb(ses) order by ses.id desc) from ses), '[]'),
    'semesters', coalesce((select jsonb_agg(to_jsonb(sem) order by sem.starts_on) from sem), '[]'),
    'reval_waiting', (select count(*) from public.reval_request r, sc where r.school_id = sc.id and r.status = 'requested'),
    'reval_fee_pending', (select count(*) from public.reval_request r join public.fee_invoice i on i.id = r.invoice_id, sc where r.school_id = sc.id and r.status = 'requested' and i.status in ('due', 'part')),
    'scripts_unmarked', (select count(*) from public.exam_script x, sc where x.school_id = sc.id and x.status = 'pending'),
    'scripts_to_decode', (select count(*) from public.exam_script x, sc where x.school_id = sc.id and x.status = 'marked'),
    'duties_today', (select count(*) from public.exam_duty d, sc where d.school_id = sc.id and d.exam_date = (now() at time zone 'Asia/Kolkata')::date),
    'can_publish', app.can_publish_results()) end;
$$;
revoke all on function public.exam_cell_overview() from public, anon;

commit;
notify pgrst, 'reload schema';
