-- Demo data only (is_sample institutions): programmes, courses and semesters
-- for the sample colleges and university campuses, built from their existing
-- "Programme Year N" classes and subjects. Real institutions are not touched.
-- Removed with the sample institutions (every table cascades from school).
begin;
do $$
declare s record; c record; v_prog bigint; v_dept bigint; v_name text; v_year int; v_code text; v_dcode text; v_course bigint; sb record; v_y record; n int;
begin
  for s in select id from public.school where is_sample and public.is_higher_ed(id) loop
    for c in select id, name from public.class where school_id = s.id and name ~ ' Year [0-9]+$' order by level loop
      v_name := regexp_replace(c.name, ' Year [0-9]+$', '');
      v_year := substring(c.name from ' Year ([0-9]+)$')::int;
      v_code := upper(regexp_replace(v_name, '[^A-Za-z]', '', 'g'));
      v_dcode := upper(coalesce(nullif(regexp_replace(split_part(v_name, ' ', 2), '[^A-Za-z]', '', 'g'), ''), regexp_replace(v_name, '[^A-Za-z]', '', 'g')));
      insert into public.department (school_id, code, name) values (s.id, left(v_dcode, 12), 'Department of ' || coalesce(nullif(split_part(v_name, ' ', 2), ''), v_name))
        on conflict (school_id, code) do nothing;
      select id into v_dept from public.department where school_id = s.id and code = left(v_dcode, 12);
      insert into public.programme (school_id, department_id, code, name, level, regulation, years, semesters, total_credits)
      values (s.id, v_dept, left(v_code, 16), v_name, case when v_name ~* '^(m|mba)' then 'pg' else 'ug' end, 'R2024',
              case when v_name ~* 'tech|pharm|nursing' then 4 when v_name ~* '^m' then 2 else 3 end,
              case when v_name ~* 'tech|pharm|nursing' then 8 when v_name ~* '^m' then 4 else 6 end, null)
        on conflict (school_id, code, regulation) do nothing;
      select id into v_prog from public.programme where school_id = s.id and code = left(v_code, 16) and regulation = 'R2024';
      update public.class set programme_id = v_prog, year_no = v_year where id = c.id;
      n := 0;
      for sb in select sbj.id, sbj.name from public.class_subject cs join public.subject sbj on sbj.id = cs.subject_id where cs.class_id = c.id order by sbj.name loop
        n := n + 1;
        insert into public.course (school_id, department_id, code, name, kind, lecture, tutorial, practical, credits)
        values (s.id, v_dept, left(v_dcode, 6) || (100 * v_year + n), sb.name, 'core', 3, 1, 0, 4)
          on conflict (school_id, code) do nothing;
        select id into v_course from public.course where school_id = s.id and name = sb.name order by id limit 1;
        update public.subject set course_id = v_course where id = sb.id and course_id is null;
        insert into public.programme_course (school_id, programme_id, course_id, semester_no) values (s.id, v_prog, v_course, 2 * v_year - 1)
          on conflict (programme_id, course_id) do nothing;
      end loop;
    end loop;
    select id, start_date, end_date into v_y from public.academic_year where school_id = s.id and is_current limit 1;
    if v_y.id is not null then
      insert into public.semester (school_id, academic_year_id, kind, starts_on, ends_on, is_current)
      values (s.id, v_y.id, 'odd', make_date(extract(year from v_y.start_date)::int, 7, 1), make_date(extract(year from v_y.start_date)::int, 11, 30), false),
             (s.id, v_y.id, 'even', make_date(extract(year from v_y.start_date)::int, 12, 15), make_date(extract(year from v_y.start_date)::int + 1, 4, 30), false)
        on conflict (academic_year_id, kind) do nothing;
      update public.semester set is_current = (now() at time zone 'Asia/Kolkata')::date between starts_on and ends_on or
        (kind = 'odd' and not exists (select 1 from public.semester x where x.school_id = s.id and (now() at time zone 'Asia/Kolkata')::date between x.starts_on and x.ends_on))
       where school_id = s.id and academic_year_id = v_y.id;
    end if;
  end loop;
end $$;
commit;
