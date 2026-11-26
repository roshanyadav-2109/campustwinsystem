-- Approved student leave marks attendance automatically.
--
-- 1. When a leave application becomes approved, any whole-day "absent" marks in
--    its date range turn into "leave" (the existing absence trigger then clears
--    the pending absence notices for those days).
-- 2. When attendance is saved later for a day covered by approved leave, an
--    "absent" mark for that student is stored as "leave". A student who actually
--    came stays present: only absent becomes leave.
-- 3. If an approved leave is later rejected or cancelled, the days it turned to
--    "leave" go back to "absent".
-- Idempotent.
begin;

create or replace function public.has_approved_leave(p_student bigint, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leave_application l
    where l.student_id = p_student and l.status = 'approved'
      and p_date between l.from_date and l.to_date);
$$;
revoke all on function public.has_approved_leave(bigint, date) from public, anon;
grant execute on function public.has_approved_leave(bigint, date) to authenticated, service_role;

-- (2) absent on a day of approved leave is stored as leave
create or replace function public.attendance_apply_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.period is null and new.status = 'absent'
     and public.has_approved_leave(new.student_id, new.on_date) then
    new.status := 'leave';
  end if;
  return new;
end $$;
drop trigger if exists trg_attendance_apply_leave on public.attendance_record;
create trigger trg_attendance_apply_leave before insert or update of status on public.attendance_record
  for each row execute function public.attendance_apply_leave();

-- (1) and (3) approving or withdrawing leave updates days already marked
create or replace function public.leave_sync_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.attendance_record a set status = 'leave'
     where a.student_id = new.student_id and a.period is null and a.status = 'absent'
       and a.on_date between new.from_date and new.to_date;
  elsif old.status = 'approved' and new.status is distinct from 'approved' then
    update public.attendance_record a set status = 'absent'
     where a.student_id = new.student_id and a.period is null and a.status = 'leave'
       and a.on_date between old.from_date and old.to_date
       and not public.has_approved_leave(a.student_id, a.on_date);
  end if;
  return new;
end $$;
drop trigger if exists trg_leave_sync_attendance on public.leave_application;
create trigger trg_leave_sync_attendance after update of status on public.leave_application
  for each row execute function public.leave_sync_attendance();

commit;
