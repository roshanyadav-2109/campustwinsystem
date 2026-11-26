-- Staff attendance and gate scanning of student ID cards.
-- * staff_attendance: one row per staff member per day (present, absent, half
--   day, leave, late; optional in / out time). The office and principal mark
--   and see everyone; each person sees their own.
-- * staff_attendance_register(date): the day's list with approved leave and
--   holidays filled in, for the register screen.
-- * staff_attendance_month(month): totals per person, for payroll.
-- * scan_student_card(token): the office, principal or transport staff scan a
--   student's ID card at the gate: present (or late if already marked absent).
--   A revoked card, a student who left, or another institution's card is refused.
begin;
create table if not exists public.staff_attendance (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  staff_id   bigint not null references public.staff(id) on delete cascade,
  on_date    date not null,
  status     text not null check (status in ('present', 'absent', 'half_day', 'leave', 'late')),
  in_time    time, out_time time,
  note       text check (note is null or char_length(note) <= 200),
  marked_by  bigint references public.staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (staff_id, on_date),
  check (out_time is null or in_time is null or out_time >= in_time)
);
create index if not exists idx_staff_att_school_date on public.staff_attendance (school_id, on_date);
alter table public.staff_attendance enable row level security;
drop policy if exists tenant_isolation on public.staff_attendance;
create policy tenant_isolation on public.staff_attendance as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists sa_read on public.staff_attendance;
create policy sa_read on public.staff_attendance for select to authenticated using ((select app.is_admin_scope()) or staff_id = (select app.my_staff_id()));
drop policy if exists sa_write on public.staff_attendance;
create policy sa_write on public.staff_attendance for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
revoke all on public.staff_attendance from anon;
grant select, insert, update, delete on public.staff_attendance to authenticated;
revoke truncate, trigger, references on public.staff_attendance from authenticated;
grant all on public.staff_attendance to service_role;

create or replace function public.staff_attendance_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff s where s.id = new.staff_id and s.school_id = new.school_id) then raise exception 'That staff member is not at this institution'; end if;
  if new.on_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Attendance cannot be marked for a future day'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_staff_attendance_same_school on public.staff_attendance;
create trigger trg_staff_attendance_same_school before insert or update on public.staff_attendance for each row execute function public.staff_attendance_same_school();

create or replace function public.staff_attendance_register(p_date date)
returns table (staff_id bigint, full_name text, role text, status text, in_time time, out_time time, note text, on_leave boolean, saved boolean, holiday text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, s.role::text,
         coalesce(a.status, case when l.id is not null then 'leave' end), a.in_time, a.out_time, a.note,
         l.id is not null, a.id is not null,
         (select e.title from public.event e where e.school_id = s.school_id and e.event_type = 'holiday' and p_date between e.start_date and coalesce(e.end_date, e.start_date) and e.class_id is null limit 1)
  from public.staff s
  left join public.staff_attendance a on a.staff_id = s.id and a.on_date = p_date
  left join lateral (select l.id from public.staff_leave l where l.staff_id = s.id and l.status = 'approved' and p_date between l.from_date and l.to_date limit 1) l on true
  where s.school_id = public.current_school_id() and coalesce(app.is_admin_scope(), false)
  order by s.role::text, s.full_name;
$$;
grant execute on function public.staff_attendance_register(date) to authenticated;

create or replace function public.staff_attendance_month(p_month date)
returns table (staff_id bigint, full_name text, role text, working_days int, present int, late int, half_day int, leave int, absent int, unmarked int)
language sql stable security definer set search_path = '' as $$
  with days as (
    select d::date dt from generate_series(date_trunc('month', p_month), least(date_trunc('month', p_month) + interval '1 month - 1 day', (now() at time zone 'Asia/Kolkata')::date), interval '1 day') d
    where extract(isodow from d) <> 7
      and not exists (select 1 from public.event e where e.school_id = public.current_school_id() and e.event_type = 'holiday' and e.class_id is null
                      and d::date between e.start_date and coalesce(e.end_date, e.start_date)))
  select s.id, s.full_name, s.role::text, (select count(*)::int from days),
    count(*) filter (where a.status = 'present')::int, count(*) filter (where a.status = 'late')::int,
    count(*) filter (where a.status = 'half_day')::int, count(*) filter (where a.status = 'leave')::int,
    count(*) filter (where a.status = 'absent')::int, count(*) filter (where a.id is null)::int
  from public.staff s cross join days
  left join public.staff_attendance a on a.staff_id = s.id and a.on_date = days.dt
  where s.school_id = public.current_school_id() and (coalesce(app.is_admin_scope(), false) or s.id = app.my_staff_id())
  group by s.id, s.full_name, s.role
  order by s.role::text, s.full_name;
$$;
grant execute on function public.staff_attendance_month(date) to authenticated;

-- ---------- gate scan ----------
create or replace function public.scan_student_card(p_token text)
returns table (ok boolean, message text, student_name text, class_label text, status text)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); k record; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_rec record; v_new text;
begin
  if not (coalesce(app.is_admin_scope(), false) or coalesce(app.is_transport(), false)) then raise exception 'Only the office, principal or transport staff can scan cards'; end if;
  p_token := lower(trim(regexp_replace(coalesce(p_token, ''), '^.*/verify/', '')));
  if p_token !~ '^[a-f0-9]{32,64}$' then return query select false, 'This is not a CampusTwin card', null::text, null::text, null::text; return; end if;
  select c.id, c.status cstatus, c.school_id, st.id sid, st.full_name, st.status sstatus, e.section_id, e.academic_year_id, cl.name || '-' || sec.name cls
    into k
    from public.id_card c join public.student st on st.id = c.student_id
    left join public.student_enrollment e on e.student_id = st.id and e.status = 'active'
      and e.academic_year_id = (select y.id from public.academic_year y where y.school_id = c.school_id and y.is_current limit 1)
    left join public.section sec on sec.id = e.section_id left join public.class cl on cl.id = sec.class_id
   where c.verify_token = p_token;
  if k.id is null then return query select false, 'Card not found', null::text, null::text, null::text; return; end if;
  if k.school_id <> v_school then return query select false, 'This card is from another institution', null::text, null::text, null::text; return; end if;
  if k.cstatus <> 'active' then return query select false, 'This card was cancelled (lost or replaced)', k.full_name, k.cls, null::text; return; end if;
  if k.sstatus <> 'active' or k.section_id is null then return query select false, 'This student is no longer enrolled', k.full_name, k.cls, null::text; return; end if;
  select a.id, a.status::text st into v_rec from public.attendance_record a where a.student_id = k.sid and a.on_date = v_today and a.period is null;
  if v_rec.id is null then
    insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, status, marked_by, school_id)
    values (k.sid, k.section_id, k.academic_year_id, v_today, 'present', app.my_staff_id(), v_school);
    v_new := 'present';
  elsif v_rec.st = 'absent' then
    update public.attendance_record set status = 'late', marked_by = app.my_staff_id() where id = v_rec.id;
    v_new := 'late';
  else
    v_new := v_rec.st;   -- already in; a second scan changes nothing
  end if;
  return query select true, case when v_rec.id is null then 'Marked present' when v_rec.st = 'absent' then 'Was absent: now marked late' else 'Already marked ' || v_rec.st end, k.full_name, k.cls, v_new;
end $$;
revoke all on function public.scan_student_card(text) from public, anon;
grant execute on function public.scan_student_card(text) to authenticated;
commit;
