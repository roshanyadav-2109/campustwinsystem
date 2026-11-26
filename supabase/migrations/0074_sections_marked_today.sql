-- How many sections have daily attendance on a date, counted in the database
-- (reading the rows hit the 1,000-row API limit at larger schools). Runs with
-- the caller's own row rules, so it only counts their own school.
create or replace function public.sections_marked_on(p_date date) returns int
language sql stable security invoker set search_path = '' as $$
  select count(distinct a.section_id)::int from public.attendance_record a
  where a.on_date = p_date and a.period is null;
$$;
grant execute on function public.sections_marked_on(date) to authenticated;
