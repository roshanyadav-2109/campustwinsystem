-- The request policy (0134) calls section_in_semester as the user: allow it,
-- limited to the caller's own institution.
begin;
create or replace function public.section_in_semester(p_student bigint, p_semester bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select e.section_id from public.student_enrollment e join public.semester s on s.id = p_semester
  where e.student_id = p_student and e.academic_year_id = s.academic_year_id and s.school_id = public.current_school_id()
  order by (e.status = 'active') desc limit 1;
$$;
grant execute on function public.section_in_semester(bigint, bigint) to authenticated;
commit;
-- the step policy must not look back at requests (the two policies looped)
begin;
drop policy if exists rs_read on public.relaxation_step;
create policy rs_read on public.relaxation_step for select to authenticated using ((select app.my_staff_id()) is not null);
commit;
