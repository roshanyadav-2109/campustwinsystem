-- Staff register: a half-day approved leave is filled in as "half day", not "leave".
begin;
create or replace function public.staff_attendance_register(p_date date)
returns table (staff_id bigint, full_name text, role text, status text, in_time time, out_time time, note text, on_leave boolean, saved boolean, holiday text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, s.role::text,
         coalesce(a.status, case when l.id is not null then (case when coalesce(l.days, 1) < 1 then 'half_day' else 'leave' end) end), a.in_time, a.out_time, a.note,
         l.id is not null, a.id is not null,
         (select e.title from public.event e where e.school_id = s.school_id and e.event_type = 'holiday' and p_date between e.start_date and coalesce(e.end_date, e.start_date) and e.class_id is null limit 1)
  from public.staff s
  left join public.staff_attendance a on a.staff_id = s.id and a.on_date = p_date
  left join lateral (select l.id, l.days from public.staff_leave l where l.staff_id = s.id and l.status = 'approved' and p_date between l.from_date and l.to_date limit 1) l on true
  where s.school_id = public.current_school_id() and coalesce(app.is_admin_scope(), false)
  order by s.role::text, s.full_name;
$$;
commit;
