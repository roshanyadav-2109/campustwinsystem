-- Seats used per course this semester, for students choosing electives
-- (they cannot read other students' registrations).
begin;
create or replace function public.course_seat_usage(p_semester bigint)
returns table (programme_course_id bigint, used int)
language sql stable security definer set search_path = '' as $$
  select r.programme_course_id, count(*)::int from public.course_registration r
  where r.semester_id = p_semester and r.status <> 'dropped' and r.school_id = public.current_school_id()
  group by r.programme_course_id;
$$;
revoke all on function public.course_seat_usage(bigint) from public, anon;
grant execute on function public.course_seat_usage(bigint) to authenticated;
commit;
