-- Shortage on screen counts up to the attendance cut-off, like hall tickets;
-- condonation only through approved relaxation requests (the chain).
begin;
create or replace function public.course_attendance(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, student_name text, subject_id bigint, subject text, held int, attended int, percent numeric, short boolean, condoned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric; v_end date;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
  elsif not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then
    raise exception 'Not allowed';
  end if;
  select attendance_minimum, coalesce(case when attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on) into v_min, v_end from public.school where id = v_school;
  return query
  select a.student_id, st.full_name, a.subject_id, sb.name,
    count(*)::int, count(*) filter (where a.status in ('present', 'late'))::int,
    round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1),
    100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min,
    exists (select 1 from public.attendance_condonation c where c.semester_id = s.id and c.student_id = a.student_id and c.subject_id = a.subject_id)
  from public.attendance_record a
  join public.student st on st.id = a.student_id join public.subject sb on sb.id = a.subject_id
  where a.school_id = v_school and a.period is not null and a.subject_id is not null
    and a.on_date between s.starts_on and v_end
    and (p_section is null or a.section_id = p_section) and (p_student is null or a.student_id = p_student)
  group by a.student_id, st.full_name, a.subject_id, sb.name
  order by st.full_name, sb.name;
end $$;
grant execute on function public.course_attendance(bigint, bigint) to authenticated;
revoke insert, update, delete on public.attendance_condonation from authenticated;
commit;
notify pgrst, 'reload schema';
