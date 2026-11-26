-- Self-test for 0060 (approved leave marks attendance). Runs in a transaction
-- and rolls back. Uses a student of the fictional Greenfield sample school.
begin;
do $$
declare
  v_student bigint; v_section bigint; v_year bigint; v_school bigint; v_leave bigint;
  d1 date := current_date - 3; d2 date := current_date - 2; d3 date := current_date - 1;
  v text;
begin
  select st.id, e.section_id, e.academic_year_id, st.school_id
    into v_student, v_section, v_year, v_school
  from public.student st
  join public.student_enrollment e on e.student_id = st.id
  join public.school sc on sc.id = st.school_id
  where sc.slug = 'greenfield' limit 1;
  if v_student is null then raise exception 'SKIP: no Greenfield student'; end if;

  delete from public.attendance_record where student_id = v_student and on_date in (d1, d2, d3) and period is null;
  -- d1 marked absent before the leave is approved
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, status, school_id)
  values (v_student, v_section, v_year, d1, null, 'absent', v_school);

  insert into public.leave_application (student_id, section_id, academic_year_id, from_date, to_date, reason, status, school_id)
  values (v_student, v_section, v_year, d1, d2, 'Test leave', 'pending', v_school) returning id into v_leave;

  update public.leave_application set status = 'approved' where id = v_leave;
  select status into v from public.attendance_record where student_id = v_student and on_date = d1 and period is null;
  if v <> 'leave' then raise exception 'FAIL: approving did not turn absent into leave (got %)', v; end if;
  if exists (select 1 from public.absence_notice where student_id = v_student and on_date = d1 and status = 'pending') then
    raise exception 'FAIL: pending absence notice left for a leave day'; end if;
  raise notice 'PASS approving leave turns earlier absent marks into leave';

  -- d2 marked absent after approval -> stored as leave
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, status, school_id)
  values (v_student, v_section, v_year, d2, null, 'absent', v_school);
  select status into v from public.attendance_record where student_id = v_student and on_date = d2 and period is null;
  if v <> 'leave' then raise exception 'FAIL: absent on a leave day was not stored as leave (got %)', v; end if;
  raise notice 'PASS absent on an approved-leave day is saved as leave';

  -- d3 is outside the leave: absent stays absent; present on a leave day stays present
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, status, school_id)
  values (v_student, v_section, v_year, d3, null, 'absent', v_school);
  select status into v from public.attendance_record where student_id = v_student and on_date = d3 and period is null;
  if v <> 'absent' then raise exception 'FAIL: day outside leave changed (got %)', v; end if;
  update public.attendance_record set status = 'present' where student_id = v_student and on_date = d2 and period is null;
  select status into v from public.attendance_record where student_id = v_student and on_date = d2 and period is null;
  if v <> 'present' then raise exception 'FAIL: a student who came was not kept present (got %)', v; end if;
  raise notice 'PASS days outside the leave and students who came are untouched';

  -- withdrawing the approval puts leave days back to absent
  update public.leave_application set status = 'cancelled' where id = v_leave;
  select status into v from public.attendance_record where student_id = v_student and on_date = d1 and period is null;
  if v <> 'absent' then raise exception 'FAIL: cancelling leave did not restore absent (got %)', v; end if;
  raise notice 'PASS cancelling an approved leave restores absent';
end $$;
rollback;
