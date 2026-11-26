-- Working days of a section in a year: days daily attendance was taken
-- (counted in the database; reading rows would hit the 1,000-row limit).
create or replace function public.section_working_days(p_section bigint, p_year bigint) returns int
language sql stable security invoker set search_path = '' as $$
  select count(distinct a.on_date)::int from public.attendance_record a
  where a.section_id = p_section and a.academic_year_id = p_year and a.period is null and a.status <> 'holiday';
$$;
grant execute on function public.section_working_days(bigint, bigint) to authenticated;
