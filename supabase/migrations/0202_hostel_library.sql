-- Hostel and library gaps:
--   * hostel passes: a hosteller (or the family) asks to go out or home; the warden (or the office) approves; the
--     leaving and the return are recorded; a late return is flagged; the family is told at each step
--   * nightly hostel roll call by the warden; students away on an approved pass are filled in; families of the absent are told
--   * library holds: a student reserves a book whose copies are all out; the first in line is told when a copy is back
--   * digital library: links to e-books, journals, lecture videos, virtual labs, grouped by kind
begin;

alter table public.hostel add column if not exists warden_staff_id bigint references public.staff(id) on delete set null;
create index if not exists idx_fk_hostel_warden on public.hostel (warden_staff_id) where warden_staff_id is not null;

-- the hostel a student lives in now, and whether the signed-in staff member runs it
create or replace function app.student_hostel(p_student bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select r.hostel_id from public.hostel_allocation a join public.hostel_room r on r.id = a.room_id
  where a.student_id = p_student and (a.to_date is null or a.to_date >= (now() at time zone 'Asia/Kolkata')::date) order by a.from_date desc limit 1;
$$;
create or replace function app.runs_hostel(p_hostel bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_admin_scope(), false) or exists (select 1 from public.hostel h where h.id = p_hostel and h.warden_staff_id = app.my_staff_id() and app.my_staff_id() is not null);
$$;
grant execute on function app.student_hostel(bigint) to authenticated;
grant execute on function app.runs_hostel(bigint) to authenticated;

create table if not exists public.hostel_pass (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  hostel_id    bigint not null references public.hostel(id) on delete cascade,
  kind         text not null check (kind in ('outing', 'home')),
  reason       text not null check (char_length(reason) between 3 and 300),
  out_at       timestamptz not null,
  back_by      timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'out', 'back')),
  requested_by uuid,
  decided_by   bigint references public.staff(id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  left_at      timestamptz,
  returned_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (back_by > out_at)
);
create index if not exists idx_hostel_pass on public.hostel_pass (hostel_id, status, out_at desc);
create index if not exists idx_hostel_pass_student on public.hostel_pass (student_id, out_at desc);
create index if not exists idx_fk_hostel_pass_decided_by on public.hostel_pass (decided_by) where decided_by is not null;
create table if not exists public.hostel_roll (
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  hostel_id  bigint not null references public.hostel(id) on delete cascade,
  on_date    date not null,
  student_id bigint not null references public.student(id) on delete cascade,
  status     text not null check (status in ('present', 'absent', 'on_pass')),
  marked_by  bigint references public.staff(id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (hostel_id, on_date, student_id)
);
create index if not exists idx_fk_hostel_roll_marked_by on public.hostel_roll (marked_by) where marked_by is not null;
do $$ declare t text; begin
  foreach t in array array['hostel_pass', 'hostel_roll'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists hp_read on public.hostel_pass;
create policy hp_read on public.hostel_pass for select to authenticated using (app.owns_student(student_id) or app.runs_hostel(hostel_id));
drop policy if exists hr_read on public.hostel_roll;
create policy hr_read on public.hostel_roll for select to authenticated using (app.owns_student(student_id) or app.runs_hostel(hostel_id));

create or replace function public.set_hostel_warden(p_hostel bigint, p_staff bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office can set the warden'; end if;
  if p_staff is not null and not exists (select 1 from public.staff where id = p_staff and school_id = public.current_school_id()) then raise exception 'Unknown staff member'; end if;
  update public.hostel set warden_staff_id = p_staff, warden = coalesce((select full_name from public.staff where id = p_staff), warden) where id = p_hostel and school_id = public.current_school_id();
  if not found then raise exception 'Unknown hostel'; end if;
end $$;
revoke all on function public.set_hostel_warden(bigint, bigint) from public, anon;
grant execute on function public.set_hostel_warden(bigint, bigint) to authenticated;

create or replace function public.ask_hostel_pass(p_student bigint, p_kind text, p_reason text, p_out timestamptz, p_back timestamptz) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_hostel bigint; v_id bigint;
begin
  if not app.owns_student(p_student) then raise exception 'Not allowed'; end if;
  v_hostel := app.student_hostel(p_student);
  if v_hostel is null then raise exception 'This student has no hostel room'; end if;
  if p_kind not in ('outing', 'home') then raise exception 'Choose outing or home'; end if;
  if p_back <= p_out then raise exception 'The return is after the leaving time'; end if;
  if p_out < now() - interval '1 hour' then raise exception 'The leaving time has passed'; end if;
  if p_back - p_out > interval '60 days' then raise exception 'Up to 60 days'; end if;
  if exists (select 1 from public.hostel_pass where student_id = p_student and status in ('pending', 'approved', 'out') and tstzrange(out_at, back_by) && tstzrange(p_out, p_back)) then raise exception 'A pass for that time already exists'; end if;
  insert into public.hostel_pass (school_id, student_id, hostel_id, kind, reason, out_at, back_by, requested_by)
  values (public.current_school_id(), p_student, v_hostel, p_kind, left(trim(p_reason), 300), p_out, p_back, auth.uid()) returning id into v_id;
  perform public.notify_safe(public.current_school_id(), 'announcement', 'hpass:' || v_id, null, h.warden_staff_id, null,
    jsonb_build_object('who', (select full_name from public.student where id = p_student)), 'Hostel pass asked', '{who} asked for a hostel pass. See Hostel.', '/dashboard/hostel?view=passes')
  from public.hostel h where h.id = v_hostel and h.warden_staff_id is not null;
  return v_id;
end $$;
revoke all on function public.ask_hostel_pass(bigint, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.ask_hostel_pass(bigint, text, text, timestamptz, timestamptz) to authenticated;

-- the warden (or office): approve, decline, mark left, mark back; the family can cancel a pass not yet used
create or replace function public.hostel_pass_step(p_id bigint, p_step text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.hostel_pass; v_title text; v_body text;
begin
  select * into p from public.hostel_pass where id = p_id and school_id = public.current_school_id() for update;
  if p.id is null then raise exception 'Unknown pass'; end if;
  if p_step = 'cancel' then
    if not app.owns_student(p.student_id) or p.status not in ('pending', 'approved') then raise exception 'This pass cannot be cancelled now'; end if;
    update public.hostel_pass set status = 'cancelled' where id = p.id; return;
  end if;
  if not app.runs_hostel(p.hostel_id) then raise exception 'Only the warden or the office can do this'; end if;
  if p_step = 'approve' and p.status = 'pending' then update public.hostel_pass set status = 'approved', decided_by = app.my_staff_id(), decision_note = left(nullif(trim(p_note), ''), 300) where id = p.id;
    v_title := 'Hostel pass approved'; v_body := 'The hostel pass from {out} to {back} is approved.';
  elsif p_step = 'decline' and p.status = 'pending' then
    if nullif(trim(p_note), '') is null then raise exception 'Say why it is declined'; end if;
    update public.hostel_pass set status = 'declined', decided_by = app.my_staff_id(), decision_note = left(trim(p_note), 300) where id = p.id;
    v_title := 'Hostel pass declined'; v_body := 'The hostel pass was declined: ' || trim(p_note);
  elsif p_step = 'left' and p.status = 'approved' then update public.hostel_pass set status = 'out', left_at = now() where id = p.id;
    v_title := 'Left the hostel'; v_body := 'Left the hostel at {now}; due back by {back}.';
  elsif p_step = 'back' and p.status = 'out' then update public.hostel_pass set status = 'back', returned_at = now() where id = p.id;
    v_title := case when now() > p.back_by then 'Back at the hostel (late)' else 'Back at the hostel' end; v_body := 'Back at the hostel at {now}.';
  else raise exception 'That step is not possible now';
  end if;
  perform public.notify_family(p.school_id, 'announcement', 'hpass:' || p.id || ':' || p_step, p.student_id,
    jsonb_build_object('out', to_char(p.out_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'back', to_char(p.back_by at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'now', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')),
    v_title, v_body, '/dashboard/hostel');
end $$;
revoke all on function public.hostel_pass_step(bigint, text, text) from public, anon;
grant execute on function public.hostel_pass_step(bigint, text, text) to authenticated;

-- tonight's roll: the hostel's residents, with those away on a pass already filled in
create or replace function public.hostel_roll_sheet(p_hostel bigint, p_day date)
returns table (student_id bigint, student_name text, room text, status text, on_pass boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, r.name || coalesce(' / ' || a.bed_no, ''), hr.status,
    exists (select 1 from public.hostel_pass hp where hp.student_id = s.id and ((hp.status = 'out' and p_day >= (hp.left_at at time zone 'Asia/Kolkata')::date) or (hp.status in ('approved', 'out') and (p_day + time '21:00') at time zone 'Asia/Kolkata' between hp.out_at and hp.back_by)))
  from public.hostel_allocation a join public.hostel_room r on r.id = a.room_id join public.student s on s.id = a.student_id
  left join public.hostel_roll hr on hr.hostel_id = p_hostel and hr.on_date = p_day and hr.student_id = s.id
  where r.hostel_id = p_hostel and a.from_date <= p_day and (a.to_date is null or a.to_date >= p_day) and app.runs_hostel(p_hostel)
  order by r.name, a.bed_no, s.full_name;
$$;
revoke all on function public.hostel_roll_sheet(bigint, date) from public, anon;
grant execute on function public.hostel_roll_sheet(bigint, date) to authenticated;

create or replace function public.mark_hostel_roll(p_hostel bigint, p_day date, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; r record;
begin
  if not app.runs_hostel(p_hostel) then raise exception 'Only the warden or the office can take the roll'; end if;
  if p_day > (now() at time zone 'Asia/Kolkata')::date or p_day < (now() at time zone 'Asia/Kolkata')::date - 3 then raise exception 'The roll is for today or the last three days'; end if;
  insert into public.hostel_roll (school_id, hostel_id, on_date, student_id, status, marked_by)
  select public.current_school_id(), p_hostel, p_day, x.student_id,
         case when x.on_pass then 'on_pass' when x.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end, app.my_staff_id()
  from public.hostel_roll_sheet(p_hostel, p_day) x
  on conflict (hostel_id, on_date, student_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
  get diagnostics n = row_count;
  for r in select x.student_id from public.hostel_roll_sheet(p_hostel, p_day) x where not x.on_pass and x.student_id = any(coalesce(p_absent, '{}')) loop
    perform public.notify_family(public.current_school_id(), 'announcement', 'hroll:' || p_hostel || ':' || p_day || ':' || r.student_id, r.student_id,
      jsonb_build_object('day', to_char(p_day, 'DD Mon')), 'Not at the hostel roll call', 'Not present at the hostel roll call on {day}. Please contact the warden.', '/dashboard/hostel');
  end loop;
  return n;
end $$;
revoke all on function public.mark_hostel_roll(bigint, date, bigint[]) from public, anon;
grant execute on function public.mark_hostel_roll(bigint, date, bigint[]) to authenticated;

-- ---------- library ----------
-- who runs the library (the office today; one place to widen later)
create or replace function app.is_library() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(app.is_office(), false); $$;
grant execute on function app.is_library() to authenticated;
create table if not exists public.library_hold (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  book_id    bigint not null references public.library_book(id) on delete cascade,
  student_id bigint not null references public.student(id) on delete cascade,
  status     text not null default 'waiting' check (status in ('waiting', 'ready', 'collected', 'cancelled')),
  ready_at   timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_library_hold_open on public.library_hold (book_id, student_id) where status in ('waiting', 'ready');
create table if not exists public.library_link (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  kind        text not null check (kind in ('ebook', 'journal', 'video', 'lab', 'database', 'other')),
  title       text not null check (char_length(title) between 1 and 160),
  url         text not null check (url ~ '^https://' and char_length(url) <= 1000),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['library_hold', 'library_link'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists lh_read on public.library_hold;
create policy lh_read on public.library_hold for select to authenticated using (app.owns_student(student_id) or (select app.is_admin_scope()) or (select app.is_library()));
drop policy if exists ll_read on public.library_link;
create policy ll_read on public.library_link for select to authenticated using (true);

create or replace function public.hold_book(p_book bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_stu bigint := app.me_student(); v_id bigint; v_free int;
begin
  if v_stu is null then raise exception 'Only a student can reserve a book'; end if;
  if not exists (select 1 from public.library_book where id = p_book and school_id = public.current_school_id() and is_active) then raise exception 'Unknown book'; end if;
  select b.copies_total - (select count(*) from public.library_issue i where i.book_id = b.id and i.returned_on is null) into v_free from public.library_book b where b.id = p_book;
  if v_free > 0 then raise exception 'A copy is on the shelf: ask at the library'; end if;
  if (select count(*) from public.library_hold where student_id = v_stu and status in ('waiting', 'ready')) >= 3 then raise exception 'Up to 3 reservations at a time'; end if;
  insert into public.library_hold (school_id, book_id, student_id) values (public.current_school_id(), p_book, v_stu) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'You have already reserved this book';
end $$;
create or replace function public.cancel_hold(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.library_hold set status = 'cancelled' where id = p_id and status in ('waiting', 'ready')
    and (app.owns_student(student_id) or coalesce(app.is_admin_scope(), false) or coalesce(app.is_library(), false));
  if not found then raise exception 'Not allowed'; end if;
end $$;
create or replace function public.collect_hold(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(app.is_admin_scope(), false) or coalesce(app.is_library(), false)) then raise exception 'Only the library can do this'; end if;
  update public.library_hold set status = 'collected' where id = p_id and status = 'ready' and school_id = public.current_school_id();
  if not found then raise exception 'Not ready'; end if;
end $$;
revoke all on function public.hold_book(bigint) from public, anon;
revoke all on function public.cancel_hold(bigint) from public, anon;
revoke all on function public.collect_hold(bigint) from public, anon;
grant execute on function public.hold_book(bigint) to authenticated;
grant execute on function public.cancel_hold(bigint) to authenticated;
grant execute on function public.collect_hold(bigint) to authenticated;

-- a returned copy goes to the first in line (who is told); a hold not collected in 3 days passes to the next
create or replace function public.library_return_to_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h public.library_hold;
begin
  if new.returned_on is not null and old.returned_on is null then
    select * into h from public.library_hold where book_id = new.book_id and status = 'waiting' order by created_at limit 1 for update skip locked;
    if h.id is not null then
      update public.library_hold set status = 'ready', ready_at = now() where id = h.id;
      perform public.notify_family(h.school_id, 'announcement', 'hold:' || h.id, h.student_id,
        jsonb_build_object('book', (select title from public.library_book where id = h.book_id)), 'Reserved book is ready', '{book} is back and kept for you at the library for 3 days.', '/dashboard/library');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_library_return_to_hold on public.library_issue;
create trigger trg_library_return_to_hold after update of returned_on on public.library_issue for each row execute function public.library_return_to_hold();

create or replace function public.save_library_link(p_id bigint, p_kind text, p_title text, p_url text, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint := p_id;
begin
  if not (coalesce(app.is_admin_scope(), false) or coalesce(app.is_library(), false)) then raise exception 'Only the library can change links'; end if;
  if coalesce(p_url, '') !~ '^https://' then raise exception 'Links start with https://'; end if;
  if v_id is null then
    insert into public.library_link (school_id, kind, title, url, note) values (public.current_school_id(), p_kind, left(trim(p_title), 160), left(p_url, 1000), left(nullif(trim(p_note), ''), 300)) returning id into v_id;
  else
    update public.library_link set kind = p_kind, title = left(trim(p_title), 160), url = left(p_url, 1000), note = left(nullif(trim(p_note), ''), 300) where id = v_id and school_id = public.current_school_id();
  end if;
  return v_id;
end $$;
create or replace function public.remove_library_link(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(app.is_admin_scope(), false) or coalesce(app.is_library(), false)) then raise exception 'Only the library can change links'; end if;
  delete from public.library_link where id = p_id and school_id = public.current_school_id();
end $$;
revoke all on function public.save_library_link(bigint, text, text, text, text) from public, anon;
revoke all on function public.remove_library_link(bigint) from public, anon;
grant execute on function public.save_library_link(bigint, text, text, text, text) to authenticated;
grant execute on function public.remove_library_link(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
