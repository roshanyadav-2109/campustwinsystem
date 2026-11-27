-- Owner (27 Nov): students and parents cannot ask for relaxations; staff raise them.
begin;
create or replace function public.request_relaxation(p_kind text, p_student bigint, p_subject bigint, p_section bigint, p_date date, p_until date, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_id bigint; v_pct numeric; v_chain text[];
begin
  select * into sc from public.school where id = v_school;
  if not public.is_higher_ed(v_school) then raise exception 'For colleges and universities'; end if;
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then raise exception 'No current semester'; end if;
  if app.my_staff_id() is null then raise exception 'Only staff can ask for a relaxation'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  select array_agg(x) into v_chain from jsonb_array_elements_text(coalesce(sc.relax_chain -> p_kind, '["head"]'::jsonb)) x;
  if p_kind = 'unlock' then
    if not (coalesce(app.is_office(), false) or app.ct_of_section(p_section, s.academic_year_id)
            or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
      raise exception 'Only the teacher of this course can ask';
    end if;
    if public.lecture_lock_reason(p_section, p_subject, p_date) is null then raise exception 'This day is not locked'; end if;
    insert into public.relaxation_request (kind, semester_id, subject_id, section_id, on_date, until, reason, chain)
    values ('unlock', s.id, p_subject, p_section, p_date, null, left(trim(p_reason), 300), v_chain) returning id into v_id;
    return v_id;
  end if;
  if p_kind not in ('attendance', 'fees') then raise exception 'Unknown request'; end if;

  if public.section_in_semester(p_student, s.id) is null then raise exception 'Unknown student'; end if;
  if p_kind = 'attendance' then
    if p_subject is null then raise exception 'Choose the course'; end if;
    select round(100.0 * count(*) filter (where a.status in ('present', 'late')) / nullif(count(*), 0), 1) into v_pct
      from public.attendance_record a where a.student_id = p_student and a.subject_id = p_subject and a.period is not null
       and a.on_date between s.starts_on and coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on);
    if v_pct is null or v_pct >= sc.attendance_minimum then raise exception 'Attendance in this course is not short'; end if;
    if sc.condone_floor is not null and v_pct < sc.condone_floor then
      raise exception 'Attendance is % %%, below % %%: it cannot be relaxed', v_pct, sc.condone_floor;
    end if;
  else
    if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date or p_until > (now() at time zone 'Asia/Kolkata')::date + 120 then
      raise exception 'Give the date by which the fees will be paid (within 120 days)';
    end if;
  end if;
  insert into public.relaxation_request (kind, semester_id, student_id, subject_id, until, reason, chain)
  values (p_kind, s.id, p_student, case when p_kind = 'attendance' then p_subject end, case when p_kind = 'fees' then p_until end, left(trim(p_reason), 300), v_chain)
  returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting for approval';
end $$;
commit;
