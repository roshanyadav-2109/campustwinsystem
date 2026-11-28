-- After review of 0202: the office runs only its own school's hostels; wardens see their hostels and the passes (with
-- names) through functions; "on pass" means left and not yet back (an overdue student can be marked absent); holds
-- are scoped to the school, a cancelled or lapsed ready hold passes to the next in line, ready holds keep the copy.
begin;

create or replace function app.runs_hostel(p_hostel bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hostel h where h.id = p_hostel and h.school_id = public.current_school_id()
                 and (coalesce(app.is_admin_scope(), false) or (h.warden_staff_id = app.my_staff_id() and app.my_staff_id() is not null)));
$$;

-- the hostels the signed-in person runs (all of them for the office)
create or replace function public.my_hostels()
returns table (id bigint, name text, kind text, warden text, warden_staff_id bigint)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, h.kind, h.warden, h.warden_staff_id from public.hostel h
  where h.school_id = public.current_school_id() and app.runs_hostel(h.id) order by h.name;
$$;
revoke all on function public.my_hostels() from public, anon;
grant execute on function public.my_hostels() to authenticated;

-- a hostel's open passes with the student's name (wardens may not otherwise see the student)
create or replace function public.hostel_open_passes(p_hostel bigint)
returns table (id bigint, student_id bigint, student_name text, kind text, reason text, out_at timestamptz, back_by timestamptz, status text, decision_note text, left_at timestamptz, returned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.student_id, s.full_name, p.kind, p.reason, p.out_at, p.back_by, p.status, p.decision_note, p.left_at, p.returned_at
  from public.hostel_pass p join public.student s on s.id = p.student_id
  where p.hostel_id = p_hostel and p.status in ('pending', 'approved', 'out') and app.runs_hostel(p_hostel)
  order by p.out_at limit 300;
$$;
revoke all on function public.hostel_open_passes(bigint) from public, anon;
grant execute on function public.hostel_open_passes(bigint) to authenticated;

-- the roll: "on pass" = left before the roll moment and not back by then (now for today's roll, 9 pm for past days;
-- a student overdue is markable)
create or replace function public.hostel_roll_sheet(p_hostel bigint, p_day date)
returns table (student_id bigint, student_name text, room text, status text, on_pass boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, r.name || coalesce(' / ' || a.bed_no, ''), hr.status,
    exists (select 1 from public.hostel_pass hp where hp.student_id = s.id and hp.left_at is not null
            and hp.left_at <= (case when p_day = (now() at time zone 'Asia/Kolkata')::date then now() else (p_day + time '21:00') at time zone 'Asia/Kolkata' end)
            and coalesce(hp.returned_at, hp.back_by) >= (case when p_day = (now() at time zone 'Asia/Kolkata')::date then now() else (p_day + time '21:00') at time zone 'Asia/Kolkata' end))
  from public.hostel_allocation a join public.hostel_room r on r.id = a.room_id join public.student s on s.id = a.student_id
  left join public.hostel_roll hr on hr.hostel_id = p_hostel and hr.on_date = p_day and hr.student_id = s.id
  where r.hostel_id = p_hostel and a.from_date <= p_day and (a.to_date is null or a.to_date >= p_day) and app.runs_hostel(p_hostel)
  order by r.name, a.bed_no, s.full_name;
$$;

create or replace function public.set_hostel_warden(p_hostel bigint, p_staff bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office can set the warden'; end if;
  if p_staff is not null and not exists (select 1 from public.staff where id = p_staff and school_id = public.current_school_id()) then raise exception 'Unknown staff member'; end if;
  update public.hostel set warden_staff_id = p_staff, warden = (select full_name from public.staff where id = p_staff) where id = p_hostel and school_id = public.current_school_id();
  if not found then raise exception 'Unknown hostel'; end if;
end $$;

-- ---------- holds ----------
-- the next in line gets the copy (and is told); used on return, cancel and lapse
create or replace function app.promote_hold(p_book bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.library_hold; v_free int;
begin
  select greatest(b.copies_total - (select count(*) from public.library_issue i where i.book_id = b.id and i.returned_on is null)
                  - (select count(*) from public.library_hold x where x.book_id = b.id and x.status = 'ready'), 0) into v_free
  from public.library_book b where b.id = p_book;
  if coalesce(v_free, 0) <= 0 then return; end if;
  select * into h from public.library_hold where book_id = p_book and status = 'waiting' order by created_at limit 1 for update;
  if h.id is null then return; end if;
  update public.library_hold set status = 'ready', ready_at = now() where id = h.id;
  perform public.notify_family(h.school_id, 'announcement', 'hold:' || h.id, h.student_id,
    jsonb_build_object('book', (select title from public.library_book where id = h.book_id)), 'Reserved book is ready', '{book} is back and kept for you at the library for 3 days.', '/dashboard/library');
end $$;
revoke all on function app.promote_hold(bigint) from public, anon, authenticated;

create or replace function public.library_return_to_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.returned_on is not null and old.returned_on is null then perform app.promote_hold(new.book_id); end if;
  return new;
end $$;

create or replace function public.cancel_hold(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_book bigint;
begin
  update public.library_hold set status = 'cancelled' where id = p_id and school_id = public.current_school_id() and status in ('waiting', 'ready')
    and (app.owns_student(student_id) or coalesce(app.is_admin_scope(), false) or coalesce(app.is_library(), false))
  returning book_id into v_book;
  if v_book is null then raise exception 'Not allowed'; end if;
  perform app.promote_hold(v_book);
end $$;

-- a reserved copy waiting for its student is not free to others
create or replace function public.hold_book(p_book bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_stu bigint := app.me_student(); v_id bigint; v_free int;
begin
  if v_stu is null then raise exception 'Only a student can reserve a book'; end if;
  if not exists (select 1 from public.library_book where id = p_book and school_id = public.current_school_id() and is_active) then raise exception 'Unknown book'; end if;
  select b.copies_total - (select count(*) from public.library_issue i where i.book_id = b.id and i.returned_on is null)
         - (select count(*) from public.library_hold x where x.book_id = b.id and x.status = 'ready') into v_free from public.library_book b where b.id = p_book;
  if v_free > 0 then raise exception 'A copy is on the shelf: ask at the library'; end if;
  if (select count(*) from public.library_hold where student_id = v_stu and status in ('waiting', 'ready')) >= 3 then raise exception 'Up to 3 reservations at a time'; end if;
  insert into public.library_hold (school_id, book_id, student_id) values (public.current_school_id(), p_book, v_stu) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'You have already reserved this book';
end $$;

-- ready holds not collected in 3 days lapse and pass on (daily)
create or replace function public.lapse_library_holds() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in update public.library_hold set status = 'cancelled' where status = 'ready' and ready_at < now() - interval '3 days' returning book_id loop
    perform app.promote_hold(r.book_id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lapse_library_holds() from public, anon, authenticated;
select cron.unschedule('library-holds-lapse') where exists (select 1 from cron.job where jobname = 'library-holds-lapse');
select cron.schedule('library-holds-lapse', '15 1 * * *', 'select public.lapse_library_holds()');
commit;
notify pgrst, 'reload schema';
