-- Saves a whole report-card scheme in one step (all or nothing), as the
-- signed-in person: the office rules and same-institution guards apply.
-- Rows that keep their id are updated; rows left out are removed (removing a
-- co-scholastic area also removes the grades given in it).
begin;
create or replace function public.save_report_scheme(p jsonb) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_id bigint := nullif(p ->> 'id', '')::bigint; x jsonb; v_keep bigint[];
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change report card schemes'; end if;
  if v_id is null then
    insert into public.report_scheme (name, board, pass_percent, overall_pass_percent, show_marks, show_grades, show_percent, final_label, notes)
    values (p ->> 'name', nullif(p ->> 'board', ''), nullif(p ->> 'pass_percent', '')::numeric, nullif(p ->> 'overall_pass_percent', '')::numeric,
            coalesce((p ->> 'show_marks')::boolean, true), coalesce((p ->> 'show_grades')::boolean, true), coalesce((p ->> 'show_percent')::boolean, true),
            coalesce(nullif(p ->> 'final_label', ''), 'Final result'), nullif(p ->> 'notes', ''))
    returning id into v_id;
  else
    update public.report_scheme set name = p ->> 'name', board = nullif(p ->> 'board', ''),
      pass_percent = nullif(p ->> 'pass_percent', '')::numeric, overall_pass_percent = nullif(p ->> 'overall_pass_percent', '')::numeric,
      show_marks = coalesce((p ->> 'show_marks')::boolean, true), show_grades = coalesce((p ->> 'show_grades')::boolean, true),
      show_percent = coalesce((p ->> 'show_percent')::boolean, true), final_label = coalesce(nullif(p ->> 'final_label', ''), 'Final result'),
      notes = nullif(p ->> 'notes', '')
    where id = v_id;
    if not found then raise exception 'Scheme not found'; end if;
  end if;

  -- terms (upsert by term number)
  for x in select * from jsonb_array_elements(coalesce(p -> 'terms', '[]')) loop
    insert into public.report_scheme_term (scheme_id, term, name, starts_on, ends_on)
    values (v_id, (x ->> 'term')::smallint, x ->> 'name', nullif(x ->> 'starts_on', '')::date, nullif(x ->> 'ends_on', '')::date)
    on conflict (scheme_id, term) do update set name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on;
  end loop;

  -- components: keep listed ids, insert new
  select coalesce(array_agg((c ->> 'id')::bigint) filter (where c ? 'id' and nullif(c ->> 'id', '') is not null), '{}') into v_keep
    from jsonb_array_elements(coalesce(p -> 'components', '[]')) c;
  delete from public.report_scheme_component where scheme_id = v_id and not (id = any(v_keep));
  for x in select * from jsonb_array_elements(coalesce(p -> 'components', '[]')) loop
    if nullif(x ->> 'id', '') is null then
      insert into public.report_scheme_component (scheme_id, term, name, assessment_type_id, rule, best_n, out_of, sort, subject_ids)
      values (v_id, (x ->> 'term')::smallint, x ->> 'name', (x ->> 'assessment_type_id')::bigint, x ->> 'rule', nullif(x ->> 'best_n', '')::smallint,
              (x ->> 'out_of')::numeric, coalesce((x ->> 'sort')::smallint, 0),
              case when jsonb_typeof(x -> 'subject_ids') = 'array' and jsonb_array_length(x -> 'subject_ids') > 0
                   then array(select jsonb_array_elements_text(x -> 'subject_ids')::bigint) end);
    else
      update public.report_scheme_component set term = (x ->> 'term')::smallint, name = x ->> 'name', assessment_type_id = (x ->> 'assessment_type_id')::bigint,
        rule = x ->> 'rule', best_n = nullif(x ->> 'best_n', '')::smallint, out_of = (x ->> 'out_of')::numeric, sort = coalesce((x ->> 'sort')::smallint, 0),
        subject_ids = case when jsonb_typeof(x -> 'subject_ids') = 'array' and jsonb_array_length(x -> 'subject_ids') > 0
                           then array(select jsonb_array_elements_text(x -> 'subject_ids')::bigint) end
      where id = (x ->> 'id')::bigint and scheme_id = v_id;
    end if;
  end loop;
  -- terms no longer listed (their components were removed above)
  delete from public.report_scheme_term where scheme_id = v_id
    and term not in (select (t ->> 'term')::smallint from jsonb_array_elements(coalesce(p -> 'terms', '[]')) t);

  -- grade bands: replace
  delete from public.report_grade_band where scheme_id = v_id;
  insert into public.report_grade_band (scheme_id, min_percent, grade, grade_point, remark)
  select v_id, (b ->> 'min_percent')::numeric, b ->> 'grade', nullif(b ->> 'grade_point', '')::numeric, nullif(b ->> 'remark', '')
  from jsonb_array_elements(coalesce(p -> 'bands', '[]')) b;

  -- co-scholastic areas: keep listed ids
  select coalesce(array_agg((a ->> 'id')::bigint) filter (where nullif(a ->> 'id', '') is not null), '{}') into v_keep
    from jsonb_array_elements(coalesce(p -> 'areas', '[]')) a;
  delete from public.report_coscholastic_area where scheme_id = v_id and not (id = any(v_keep));
  for x in select * from jsonb_array_elements(coalesce(p -> 'areas', '[]')) loop
    if nullif(x ->> 'id', '') is null then
      insert into public.report_coscholastic_area (scheme_id, name, grades, sort)
      values (v_id, x ->> 'name', array(select jsonb_array_elements_text(x -> 'grades')), coalesce((x ->> 'sort')::smallint, 0));
    else
      update public.report_coscholastic_area set name = x ->> 'name', grades = array(select jsonb_array_elements_text(x -> 'grades')),
        sort = coalesce((x ->> 'sort')::smallint, 0)
      where id = (x ->> 'id')::bigint and scheme_id = v_id;
    end if;
  end loop;

  -- subjects: replace
  delete from public.report_scheme_subject where scheme_id = v_id;
  insert into public.report_scheme_subject (scheme_id, subject_id, mode, sort)
  select v_id, (s ->> 'subject_id')::bigint, coalesce(s ->> 'mode', 'counted'), coalesce((s ->> 'sort')::smallint, 0)
  from jsonb_array_elements(coalesce(p -> 'subjects', '[]')) s;
  return v_id;
end $$;
revoke all on function public.save_report_scheme(jsonb) from public, anon;
grant execute on function public.save_report_scheme(jsonb) to authenticated;
commit;
