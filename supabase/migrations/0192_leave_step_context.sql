-- What a Head or Dean sees when recommending leave: the balance left of that leave type (after this request) and the
-- lessons in those days with how many already have a substitute.
begin;
drop function if exists public.my_leave_steps();
create function public.my_leave_steps()
returns table (id bigint, staff_name text, from_date date, to_date date, days numeric, reason text, step text, leave_type text, balance_left numeric, lessons int, covered int)
language sql stable security definer set search_path = '' as $$
  with hd as (select app.my_headed_departments() d), dd as (select app.my_dean_departments() d)
  select l.id, s.full_name, l.from_date, l.to_date, l.days, l.reason, l.step, lt.name,
    case when lt.is_paid then lt.days_per_year - coalesce((select sum(o.days) from public.staff_leave o where o.staff_id = l.staff_id and o.leave_type_id = l.leave_type_id
      and o.academic_year_id = l.academic_year_id and o.status in ('pending', 'approved')), 0) end,
    (select count(*)::int from generate_series(l.from_date, least(l.to_date, l.from_date + 30), interval '1 day') g(dt)
       join public.timetable_slot t on t.staff_id = l.staff_id and t.day_of_week = extract(isodow from g.dt)::int
       join public.academic_year y on y.id = t.academic_year_id and y.is_current),
    (select count(*)::int from public.substitution sb where sb.absent_staff_id = l.staff_id and sb.on_date between l.from_date and l.to_date)
  from public.staff_leave l join public.staff s on s.id = l.staff_id left join public.staff_leave_type lt on lt.id = l.leave_type_id
  where l.school_id = public.current_school_id() and l.status = 'pending' and l.staff_id <> app.my_staff_id() and l.step in ('hod', 'dean')
    and exists (select 1 from app.staff_home_departments(l.staff_id) x where (l.step = 'hod' and x in (select d from hd)) or (l.step = 'dean' and x in (select d from dd)))
  order by l.from_date;
$$;
revoke all on function public.my_leave_steps() from public, anon;
grant execute on function public.my_leave_steps() to authenticated;
commit;
notify pgrst, 'reload schema';
