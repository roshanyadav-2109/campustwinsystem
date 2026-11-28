-- Exam department extras: rooms by rows and benches, booklet numbers, late arrivals, scribes and extra time,
-- duty swaps and leave, remuneration, script photocopies, supplementary results from the university.
begin;
alter table public.exam_room add column if not exists rows_n smallint check (rows_n is null or rows_n between 1 and 60),
  add column if not exists benches_n smallint check (benches_n is null or benches_n between 1 and 30),
  add column if not exists per_bench smallint not null default 1 check (per_bench between 1 and 3);
alter table public.exam_seat add column if not exists seat_label text, add column if not exists booklet_no text check (booklet_no is null or char_length(booklet_no) <= 30),
  add column if not exists extra_sheets smallint check (extra_sheets is null or extra_sheets between 0 and 40), add column if not exists late boolean not null default false;
create table if not exists public.exam_accommodation (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  session_id  bigint references public.exam_session(id) on delete cascade,
  scribe      boolean not null default false,
  scribe_name text check (scribe_name is null or char_length(scribe_name) <= 80),
  extra_minutes smallint not null default 0 check (extra_minutes between 0 and 120),
  note        text check (note is null or char_length(note) <= 200),
  unique nulls not distinct (student_id, session_id)
);
create table if not exists public.exam_rate (
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  kind      text not null check (kind in ('duty', 'script')),
  amount    numeric(10,2) not null check (amount >= 0),
  primary key (school_id, kind)
);
do $$ declare t text;
begin
  foreach t in array array['exam_accommodation', 'exam_rate'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists ex_rw on public.%I', t);
    execute format('create policy ex_rw on public.%I for all to authenticated using ((select app.is_exams())) with check ((select app.is_exams_lead()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
alter table public.reval_request drop constraint if exists reval_request_kind_check;
alter table public.reval_request add constraint reval_request_kind_check check (kind in ('revaluation', 'retotalling', 'photocopy'));
alter table public.reval_request drop constraint if exists reval_request_status_check;
alter table public.reval_request add constraint reval_request_status_check check (status in ('requested', 'revised', 'no_change', 'rejected', 'withdrawn', 'supplied'));
alter table public.reval_request add column if not exists file_key text;
alter table public.school add column if not exists photocopy_fee numeric(10,2) check (photocopy_fee is null or photocopy_fee >= 0);

-- a room's seats follow its rows and benches when given
create or replace function public.exam_room_capacity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rows_n is not null and new.benches_n is not null then new.capacity := new.rows_n * new.benches_n * new.per_bench; end if;
  return new;
end $$;
drop trigger if exists trg_exam_room_capacity on public.exam_room;
create trigger trg_exam_room_capacity before insert or update on public.exam_room for each row execute function public.exam_room_capacity();

create or replace function public.generate_seating(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); sl record; n int := 0; v_need int; v_cap int;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can plan seating'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  if exists (select 1 from public.exam_seat where session_id = p_session and (present is not null or exam_date < (now() at time zone 'Asia/Kolkata')::date)) then
    raise exception 'The exam has started (attendance is marked or a paper is over); seating can no longer be re-planned';
  end if;
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
  update public.exam_seat x set seat_label = case when r.rows_n is null or r.benches_n is null then x.seat_no::text else
      'R' || (((x.seat_no - 1) / r.per_bench) / r.benches_n + 1) || '-B' || (((x.seat_no - 1) / r.per_bench) % r.benches_n + 1)
      || case when r.per_bench > 1 then chr(65 + ((x.seat_no - 1) % r.per_bench)) else '' end end
  from public.exam_room r where r.id = x.room_id and x.session_id = p_session;
  select count(*) into n from public.exam_seat where session_id = p_session;
  return n;
end $$;

create or replace function public.assign_duties(p_session bigint, p_per_room int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_pool bigint[]; v_avail bigint[]; v_per int := least(greatest(coalesce(p_per_room, 1), 1), 4);
  sl record; n int := 0; k int; v_short text[] := '{}'; v_off int := 0; v_end time;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can assign duties'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  delete from public.exam_duty where session_id = p_session;
  -- exam-centre staff first, then teachers; fewest duties this year first
  select array_agg(x.id order by x.pri, x.load, x.id) into v_pool from (
    select st.id, case when exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)) then 0 else 1 end pri,
      (select count(*) from public.exam_duty d join public.exam_session es on es.id = d.session_id join public.academic_year y on y.id = es.academic_year_id and y.is_current where d.staff_id = st.id) load
    from public.staff st where st.school_id = v_school
      and (st.role in ('subject_teacher', 'class_teacher') or exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)))) x;
  if coalesce(cardinality(v_pool), 0) = 0 then raise exception 'There are no teachers to assign'; end if;
  for sl in select exam_date, starts_at, array_agg(distinct room_id) rooms from public.exam_seat where session_id = p_session group by 1, 2 order by 1, 2 loop
    select max(ends_at) into v_end from public.exam_paper where session_id = p_session and exam_date = sl.exam_date and starts_at = sl.starts_at;
    -- nobody already on duty in another exam at an overlapping time
    select array_agg(p order by i) into v_avail from unnest(v_pool) with ordinality u(p, i)
     where not exists (select 1 from public.staff_leave l where l.staff_id = u.p and l.status = 'approved' and sl.exam_date between l.from_date and l.to_date)
       and not exists (select 1 from public.exam_duty d join public.exam_paper op on op.session_id = d.session_id and op.exam_date = d.exam_date and op.starts_at = d.starts_at
                       where d.staff_id = u.p and d.exam_date = sl.exam_date and d.session_id <> p_session
                         and (op.starts_at, op.ends_at) overlaps (sl.starts_at, coalesce(v_end, sl.starts_at + interval '3 hours')));
    k := coalesce(cardinality(v_avail), 0);
    if k < cardinality(sl.rooms) * v_per then v_short := v_short || (to_char(sl.exam_date, 'DD Mon') || ' ' || to_char(sl.starts_at, 'HH24:MI')); end if;
    if k = 0 then continue; end if;
    insert into public.exam_duty (school_id, session_id, exam_date, starts_at, room_id, staff_id)
    select v_school, p_session, sl.exam_date, sl.starts_at, r.room, v_avail[((v_off + g.pos) % k) + 1]
    from (select room, row_number() over (order by room) rn from unnest(sl.rooms) room) r
    cross join generate_series(1, v_per) gg(j)
    cross join lateral (select ((r.rn - 1) * v_per + gg.j - 1)::int pos) g
    where (r.rn - 1) * v_per + gg.j <= k
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
    v_off := v_off + cardinality(sl.rooms) * v_per;
  end loop;
  return jsonb_build_object('assigned', n, 'short', case when cardinality(v_short) > 0 then array_to_string(v_short, ', ') end);
end $$;
revoke all on function public.assign_duties(bigint, int) from public, anon;
grant execute on function public.assign_duties(bigint, int) to authenticated;

create or replace function public.swap_duty(p_duty bigint, p_staff bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.exam_duty; v_end time;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can change duties'; end if;
  select * into d from public.exam_duty where id = p_duty and school_id = public.current_school_id() for update;
  if d.id is null then raise exception 'Unknown duty'; end if;
  if not exists (select 1 from public.staff where id = p_staff and school_id = d.school_id) then raise exception 'Unknown staff member'; end if;
  select max(ends_at) into v_end from public.exam_paper where session_id = d.session_id and exam_date = d.exam_date and starts_at = d.starts_at;
  if exists (select 1 from public.staff_leave l where l.staff_id = p_staff and l.status = 'approved' and d.exam_date between l.from_date and l.to_date) then raise exception 'That person is on leave that day'; end if;
  if exists (select 1 from public.exam_duty o join public.exam_paper op on op.session_id = o.session_id and op.exam_date = o.exam_date and op.starts_at = o.starts_at
             where o.staff_id = p_staff and o.exam_date = d.exam_date and o.id <> d.id
               and (op.starts_at, op.ends_at) overlaps (d.starts_at, coalesce(v_end, d.starts_at + interval '3 hours'))) then
    raise exception 'That person already has a duty at that time';
  end if;
  update public.exam_duty set staff_id = p_staff where id = d.id;
end $$;
revoke all on function public.swap_duty(bigint, bigint) from public, anon;
grant execute on function public.swap_duty(bigint, bigint) to authenticated;

-- the room roster: seat, booklet, late, and any scribe or extra time
drop function if exists public.my_room_roster(bigint, date, time, bigint);
create function public.my_room_roster(p_session bigint, p_date date, p_start time, p_room bigint default null)
returns table (seat_id bigint, seat_no int, seat_label text, student_name text, admission_no text, room text, present boolean, booklet_no text, extra_sheets smallint, late boolean, needs text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.seat_no, coalesce(x.seat_label, x.seat_no::text), st.full_name, st.admission_no, r.name, x.present, x.booklet_no, x.extra_sheets, x.late,
    (select nullif(concat_ws(', ', case when a.scribe then 'Scribe' || coalesce(': ' || a.scribe_name, '') end, case when a.extra_minutes > 0 then a.extra_minutes || ' min extra' end, a.note), '')
       from public.exam_accommodation a where a.student_id = x.student_id and (a.session_id = x.session_id or a.session_id is null) order by a.session_id nulls last limit 1)
  from public.exam_seat x join public.student st on st.id = x.student_id join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.exam_date = p_date and x.starts_at = p_start and x.school_id = public.current_school_id()
    and (p_room is null or x.room_id = p_room) and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()))
  order by r.name, x.seat_no;
$$;
revoke all on function public.my_room_roster(bigint, date, time, bigint) from public, anon;
grant execute on function public.my_room_roster(bigint, date, time, bigint) to authenticated;

create or replace function public.save_booklets(p_seats bigint[], p_booklets text[], p_extra int[], p_late boolean[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if cardinality(p_seats) <> cardinality(p_booklets) or cardinality(p_seats) <> cardinality(p_extra) or cardinality(p_seats) <> cardinality(p_late) then raise exception 'The lists do not line up'; end if;
  update public.exam_seat x set booklet_no = nullif(left(trim(y.b), 30), ''), extra_sheets = y.e, late = coalesce(y.l, false)
  from unnest(p_seats, p_booklets, p_extra, p_late) as y(id, b, e, l)
  where x.id = y.id and x.school_id = public.current_school_id() and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.save_booklets(bigint[], text[], int[], boolean[]) from public, anon;
grant execute on function public.save_booklets(bigint[], text[], int[], boolean[]) to authenticated;

drop function if exists public.seating_chart(bigint);
create function public.seating_chart(p_session bigint)
returns table (exam_date date, starts_at time, room text, seat_no int, seat_label text, student_name text, admission_no text, invigilators text, needs text)
language sql stable security definer set search_path = '' as $$
  select x.exam_date, x.starts_at, r.name, x.seat_no, coalesce(x.seat_label, x.seat_no::text), st.full_name, st.admission_no,
    (select string_agg(s2.full_name, ', ') from public.exam_duty d join public.staff s2 on s2.id = d.staff_id
      where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id),
    (select nullif(concat_ws(', ', case when a.scribe then 'Scribe' end, case when a.extra_minutes > 0 then a.extra_minutes || ' min extra' end), '')
       from public.exam_accommodation a where a.student_id = x.student_id and (a.session_id = x.session_id or a.session_id is null) order by a.session_id nulls last limit 1)
  from public.exam_seat x join public.exam_room r on r.id = x.room_id join public.student st on st.id = x.student_id
  where x.session_id = p_session and x.school_id = (select public.current_school_id()) and (select app.is_exams())
  order by x.exam_date, x.starts_at, r.sort, r.name, x.seat_no;
$$;
revoke all on function public.seating_chart(bigint) from public, anon;
grant execute on function public.seating_chart(bigint) to authenticated;

drop function if exists public.session_seats(bigint, bigint, bigint);
create function public.session_seats(p_session bigint, p_student bigint default null, p_section bigint default null)
returns table (student_id bigint, exam_date date, starts_at time, room text, seat_no int, seat_label text)
language sql stable security definer set search_path = '' as $$
  select x.student_id, x.exam_date, x.starts_at, r.name, x.seat_no, coalesce(x.seat_label, x.seat_no::text)
  from public.exam_seat x join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.school_id = (select public.current_school_id())
    and (p_student is null or x.student_id = p_student)
    and (p_section is null or exists (select 1 from public.student_enrollment e where e.student_id = x.student_id and e.section_id = p_section and e.status = 'active'))
    and ((select app.is_exams()) or (select coalesce(app.is_admin_scope(), false)) or (p_student is not null and app.owns_student(p_student))
         or (p_section is not null and app.ct_of_section(p_section, null)))
  order by x.student_id, x.exam_date, x.starts_at, x.id;
$$;
revoke all on function public.session_seats(bigint, bigint, bigint) from public, anon;
grant execute on function public.session_seats(bigint, bigint, bigint) to authenticated;

-- what each invigilator and evaluator is owed for an exam
create or replace function public.exam_remuneration(p_session bigint)
returns table (staff_id bigint, staff_name text, employee_code text, duties int, scripts int, duty_amount numeric, script_amount numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  with rate as (select coalesce(max(amount) filter (where kind = 'duty'), 0) d, coalesce(max(amount) filter (where kind = 'script'), 0) s
                from public.exam_rate where school_id = (select public.current_school_id())),
  du as (select d.staff_id, count(*)::int n from public.exam_duty d where d.session_id = p_session group by 1),
  sc as (select x.evaluator_id staff_id, count(*)::int n from public.exam_script x join public.exam_paper p on p.id = x.paper_id
         where p.session_id = p_session and x.evaluator_id is not null and not x.is_absent and x.status in ('marked', 'decoded') group by 1),
  who as (select staff_id from du union select staff_id from sc)
  select st.id, st.full_name, st.employee_code, coalesce(du.n, 0), coalesce(sc.n, 0), coalesce(du.n, 0) * rate.d, coalesce(sc.n, 0) * rate.s,
         coalesce(du.n, 0) * rate.d + coalesce(sc.n, 0) * rate.s
  from who join public.staff st on st.id = who.staff_id left join du on du.staff_id = who.staff_id left join sc on sc.staff_id = who.staff_id, rate
  where st.school_id = (select public.current_school_id()) and (select app.is_exams())
    and exists (select 1 from public.exam_session es where es.id = p_session and es.school_id = st.school_id)
  order by st.full_name;
$$;
revoke all on function public.exam_remuneration(bigint) from public, anon;
grant execute on function public.exam_remuneration(bigint) to authenticated;

-- a photocopy of the answer script: the exam cell supplies the scan; the student downloads it
create or replace function public.supply_photocopy(p_id bigint, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams() then raise exception 'Only the exam cell can supply a photocopy'; end if;
  if p_key is null or p_key !~ ('^' || (select coalesce(s.slug, 'x') from public.school s where s.id = public.current_school_id()) || '/') and p_key !~ '^[a-z0-9-]+/' then raise exception 'Bad file'; end if;
  update public.reval_request set status = 'supplied', file_key = p_key, decided_by = app.my_staff_id(), decided_at = now()
   where id = p_id and school_id = public.current_school_id() and kind = 'photocopy' and status = 'requested';
  if not found then raise exception 'No photocopy request waiting'; end if;
end $$;
revoke all on function public.supply_photocopy(bigint, text) from public, anon;
grant execute on function public.supply_photocopy(bigint, text) to authenticated;

create or replace function public.request_revaluation(p_result bigint, p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); cr public.course_result; sc public.school; v_fee numeric; v_inv bigint; v_id bigint; v_year bigint;
begin
  select * into cr from public.course_result where id = p_result and school_id = v_school;
  if cr.id is null then raise exception 'Unknown result'; end if;
  if p_kind not in ('revaluation', 'retotalling', 'photocopy') then raise exception 'Choose revaluation, retotalling or a photocopy'; end if;
  if not (app.owns_student(cr.student_id) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if cr.grade = 'Ab' then raise exception 'There is no answer script to revalue (absent)'; end if;
  if cr.attempt > 1 then raise exception 'Revaluation is for the first attempt; ask the exam cell about re-takes'; end if;
  if exists (select 1 from public.reval_request x where x.result_id = cr.id and x.kind = p_kind and x.status <> 'withdrawn') then
    raise exception 'A % has already been asked for this course', p_kind;
  end if;
  if public.result_hold(cr.student_id, cr.semester_id) is not null and not app.is_exams() then raise exception 'This result is held back'; end if;
  select * into sc from public.school where id = v_school;
  if not app.is_exams() and (cr.published_at at time zone 'Asia/Kolkata')::date + sc.reval_window_days < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Requests closed % days after the results', sc.reval_window_days;
  end if;
  v_fee := case p_kind when 'revaluation' then sc.reval_fee when 'photocopy' then sc.photocopy_fee else sc.retotal_fee end;
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  insert into public.reval_request (school_id, result_id, student_id, kind, old_ese, old_grade) values (v_school, cr.id, cr.student_id, p_kind, cr.ese, cr.grade)
  returning id into v_id;
  if coalesce(v_fee, 0) > 0 and v_year is not null then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, cr.student_id, public.section_in_semester(cr.student_id, (select id from public.semester where school_id = v_school and is_current)), v_year,
            left(initcap(p_kind) || ' fee: ' || (select code from public.course where id = cr.course_id) || ' #' || v_id, 80), v_fee, (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.reval_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting';
end $$;

drop function if exists public.import_university_results(bigint, jsonb);
drop function if exists public.import_university_results(bigint, jsonb, text);
create function public.import_university_results(p_semester bigint, p_rows jsonb, p_kind text default 'regular') returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_ids bigint[]; n int := 0; k int; v_bad text; v_m jsonb;
begin
  if not app.can_publish_results() then raise exception 'Results are imported by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  if p_kind not in ('regular', 'supplementary') then raise exception 'Choose regular or supplementary results'; end if;
  -- a row names the student by university register number or admission number
  select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'course_id', c.id, 'credits', c.credits, 'grade', case when upper(trim(r.grade)) = 'AB' then 'Ab' else nullif(trim(r.grade), '') end, 'point', case when upper(trim(r.grade)) in ('AB', 'WH') then 0 else coalesce(r.point, 0) end,
         'passed', case when upper(trim(r.grade)) in ('AB', 'WH', 'F') then false else coalesce(r.passed, coalesce(r.point, 0) > 0) end, 'key', coalesce(nullif(trim(r.register_no), ''), trim(r.admission_no), '?') || '/' || coalesce(trim(r.course_code), '?'))), '[]')
    into v_m
  from jsonb_to_recordset(p_rows) as r(admission_no text, register_no text, course_code text, grade text, point numeric, passed boolean)
  left join public.student st on st.school_id = v_school and ((nullif(trim(r.register_no), '') is not null and st.university_reg_no = trim(r.register_no))
                                                              or (nullif(trim(r.register_no), '') is null and st.admission_no = trim(r.admission_no)))
  left join public.course c on c.school_id = v_school and c.code = trim(r.course_code);
  select string_agg(key, ', ') into v_bad from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where student_id is null or course_id is null or grade is null;
  if v_bad is not null then raise exception 'These rows do not match a student and a course: %', left(v_bad, 300); end if;
  select string_agg(distinct key, ', ') into v_bad from (select key from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) group by key, student_id, course_id having count(*) > 1) d;
  if v_bad is not null then raise exception 'These appear twice in the file: %', left(v_bad, 300); end if;
  -- where the student registered for courses this semester, only those courses
  select string_agg(u.key, ', ') into v_bad from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
   where exists (select 1 from public.course_registration cr where cr.student_id = u.student_id and cr.semester_id = p_semester)
     and not exists (select 1 from public.course_registration cr join public.programme_course pc on pc.id = cr.programme_course_id
                     where cr.student_id = u.student_id and cr.semester_id = p_semester and pc.course_id = u.course_id and coalesce(cr.status, '') <> 'dropped');
  if v_bad is not null then raise exception 'Not registered for these courses this semester: %', left(v_bad, 300); end if;
  -- WH: the university withheld the result; nothing is written for that course, the semester line says so
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, backlogs, published_by, published_as, withheld_reason)
  select distinct v_school, p_semester, u.student_id, 0, 0, null::numeric, 0, app.my_staff_id(), 'Imported from the university', 'Withheld by the university'
  from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where upper(u.grade) = 'WH'
  on conflict (semester_id, student_id) do update set withheld_reason = 'Withheld by the university';
  v_m := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_m) x where upper(x ->> 'grade') <> 'WH'), '[]');
  -- supplementary: a new attempt for each course (the earlier ones stay)
  if p_kind = 'supplementary' then
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed, kind)
    select v_school, p_semester, u.student_id, u.course_id,
           coalesce((select max(cr.attempt) from public.course_result cr where cr.student_id = u.student_id and cr.course_id = u.course_id), 0) + 1,
           u.credits, u.grade, case when u.passed then u.point else 0 end, u.passed, 'supplementary'
    from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text);
    get diagnostics n = row_count;
    select coalesce(array_agg(distinct (x ->> 'student_id')::bigint), '{}') into v_ids from jsonb_array_elements(v_m) x;
    perform public.refresh_cgpa(v_ids);
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (v_school, 'results_published', p_semester, jsonb_build_object('students', to_jsonb(v_ids), 'revised', true));
    return n;
  end if;
  -- results already there are revised (the old line is kept), not replaced
  insert into public.course_result_revision (school_id, revised_by, reason, old)
  select cr.school_id, app.my_staff_id(), 'Imported from the university', to_jsonb(cr)
  from public.course_result cr join jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) on u.student_id = cr.student_id and u.course_id = cr.course_id
  where cr.semester_id = p_semester and cr.attempt = 1 and (cr.grade, cr.point, cr.passed) is distinct from (u.grade, case when u.passed then u.point else 0 end, u.passed);
  update public.course_result cr set grade = u.grade, point = case when u.passed then u.point else 0 end, passed = u.passed, credits = u.credits
  from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where u.student_id = cr.student_id and u.course_id = cr.course_id and cr.semester_id = p_semester and cr.attempt = 1;
  get diagnostics k = row_count; n := n + k;
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed)
  select v_school, p_semester, u.student_id, u.course_id, 1, u.credits, u.grade, case when u.passed then u.point else 0 end, u.passed from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
  where not exists (select 1 from public.course_result cr where cr.semester_id = p_semester and cr.student_id = u.student_id and cr.course_id = u.course_id and cr.attempt = 1);
  get diagnostics k = row_count; n := n + k;
  select coalesce(array_agg(distinct student_id), '{}') into v_ids from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text);
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, backlogs, published_by, published_as)
  select v_school, p_semester, x, 0, 0, null, 0, app.my_staff_id(), 'Imported from the university' from unnest(v_ids) x
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_semester_line(x, p_semester) from unnest(v_ids) x;
  perform public.refresh_cgpa(v_ids);
  insert into public.notification_outbox (school_id, event_key, ref_id, payload)
  values (v_school, 'results_published', p_semester, jsonb_build_object('students', to_jsonb(v_ids), 'revised', true));
  return n;
end $$;
revoke all on function public.import_university_results(bigint, jsonb, text) from public, anon;
grant execute on function public.import_university_results(bigint, jsonb, text) to authenticated;
commit;
notify pgrst, 'reload schema';
