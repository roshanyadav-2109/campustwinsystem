-- The exam cell (examinations head, deputy, exam section) reads students,
-- enrolments, assessments and marks across the campus: hall tickets, results
-- and grade cards cover every section. Read only; writing stays as it was.
begin;
do $$ declare t text; begin
  foreach t in array array['student', 'student_enrollment', 'assessment', 'mark'] loop
    execute format('drop policy if exists exams_read on public.%I', t);
    execute format('create policy exams_read on public.%I for select to authenticated using ((select app.is_exams()))', t);
  end loop;
end $$;
commit;
