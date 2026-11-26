-- Staff leave types for every school.
--
-- Before: the four standard leave types were inserted once (0044) for the first
-- school only. Every school created after that had none, so its staff could not
-- apply for leave, and there was no screen to add them.
--
-- Now:
--   * a leave type can be switched off (kept for history) instead of deleted;
--   * every school without leave types gets the standard four;
--   * every new school or campus gets them the moment it is created.
-- The office manages them in Staff HR, Leave types. Idempotent.
begin;

alter table public.staff_leave_type add column if not exists active boolean not null default true;

create or replace function public.seed_staff_leave_types(p_school bigint) returns void
language sql security definer set search_path = '' as $$
  insert into public.staff_leave_type (school_id, code, name, days_per_year, is_paid) values
    (p_school, 'CL',  'Casual leave',      12, true),
    (p_school, 'SL',  'Sick leave',        10, true),
    (p_school, 'EL',  'Earned leave',      15, true),
    (p_school, 'LWP', 'Leave without pay',  0, false)
  on conflict (school_id, code) do nothing;
$$;
revoke all on function public.seed_staff_leave_types(bigint) from public, anon, authenticated;

create or replace function public.school_seed_leave_types() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_staff_leave_types(new.id);
  return new;
end $$;
drop trigger if exists trg_school_seed_leave_types on public.school;
create trigger trg_school_seed_leave_types after insert on public.school
  for each row execute function public.school_seed_leave_types();

-- backfill: schools that have no leave types yet
select public.seed_staff_leave_types(s.id)
from public.school s
where not exists (select 1 from public.staff_leave_type t where t.school_id = s.id);

commit;
