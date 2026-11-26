-- Report cards, after the review of the screens:
-- * save_report_entries: grades, remarks, result line and attendance for many
--   students at once, in one step (all or nothing), as the signed-in person.
--   Only the fields sent are changed; an empty value clears that one field.
-- * set_report_assignment: which scheme a class / section uses, in one step.
begin;
create or replace function public.save_report_entries(p_year bigint, p_term smallint, p_rows jsonb) returns int
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; g jsonb; v_sid bigint; v_n int := 0; v_staff bigint := app.my_staff_id(); v_scheme_terms smallint[];
begin
  if p_term < 0 or p_term > 6 then raise exception 'Unknown term'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_sid := (r ->> 'student_id')::bigint;
    if r ? 'grades' then
      for g in select * from jsonb_array_elements(r -> 'grades') loop
        if coalesce(g ->> 'grade', '') = '' then
          delete from public.report_coscholastic_grade where student_id = v_sid and academic_year_id = p_year and area_id = (g ->> 'area_id')::bigint and term = p_term;
        else
          insert into public.report_coscholastic_grade (academic_year_id, student_id, area_id, term, grade, entered_by)
          values (p_year, v_sid, (g ->> 'area_id')::bigint, p_term, g ->> 'grade', v_staff)
          on conflict (student_id, academic_year_id, area_id, term) do update set grade = excluded.grade, entered_by = excluded.entered_by, updated_at = now();
        end if;
      end loop;
    end if;
    if r ? 'remark' or r ? 'result_text' then
      if coalesce(r ->> 'remark', '') = '' and coalesce(r ->> 'result_text', '') = '' then
        delete from public.report_remark where student_id = v_sid and academic_year_id = p_year and term = p_term;
      else
        insert into public.report_remark (academic_year_id, student_id, term, remark, result_text, entered_by)
        values (p_year, v_sid, p_term, left(coalesce(r ->> 'remark', ''), 500), nullif(left(coalesce(r ->> 'result_text', ''), 120), ''), v_staff)
        on conflict (student_id, academic_year_id, term) do update set remark = excluded.remark, result_text = excluded.result_text, entered_by = excluded.entered_by, updated_at = now();
      end if;
    end if;
    if r ? 'present' or r ? 'working' then
      if coalesce(r ->> 'present', '') = '' and coalesce(r ->> 'working', '') = '' then
        delete from public.report_attendance where student_id = v_sid and academic_year_id = p_year and term = p_term;
      else
        insert into public.report_attendance (academic_year_id, student_id, term, present, working)
        values (p_year, v_sid, p_term, (r ->> 'present')::smallint, (r ->> 'working')::smallint)
        on conflict (student_id, academic_year_id, term) do update set present = excluded.present, working = excluded.working;
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.save_report_entries(bigint, smallint, jsonb) from public, anon;
grant execute on function public.save_report_entries(bigint, smallint, jsonb) to authenticated;

create or replace function public.set_report_assignment(p_year bigint, p_class bigint, p_section bigint, p_scheme bigint) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can choose report card schemes'; end if;
  delete from public.report_scheme_assignment where academic_year_id = p_year and class_id = p_class and section_id is not distinct from p_section;
  if p_scheme is not null then
    insert into public.report_scheme_assignment (academic_year_id, class_id, section_id, scheme_id) values (p_year, p_class, p_section, p_scheme);
  end if;
end $$;
revoke all on function public.set_report_assignment(bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.set_report_assignment(bigint, bigint, bigint, bigint) to authenticated;
commit;
