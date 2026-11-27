-- Sample colleges and campuses only (school.is_sample): a faculty over their
-- departments, and people in positions: head, Dean (who is also Director of a
-- department, to show two positions), Heads of Department, Controller of
-- Examinations. clean-sample.mjs removes them with the institution.
begin;
do $$ declare s record; v_unit bigint; v_head bigint; v_dean bigint; v_coe bigint; d record; v_t bigint; n int := 0;
begin
  for s in select sc.id, sc.name, sc.university_id is not null uni from public.school sc where sc.is_sample and public.is_higher_ed(sc.id)
              and not exists (select 1 from public.staff_position p where p.school_id = sc.id) loop
    insert into public.academic_unit (school_id, code, name, kind)
    values (s.id, 'FAC1', case when s.name ilike '%commerce%' then 'Faculty of Commerce and Arts' when s.name ilike '%health%' then 'School of Health Sciences'
                               when s.name ilike '%technology%' then 'Faculty of Engineering and Technology' else 'Faculty of Management and Sciences' end, 'faculty')
    on conflict (school_id, code) do update set name = excluded.name returning id into v_unit;
    update public.department set unit_id = v_unit where school_id = s.id;
    -- the head: the principal record, else the first office record
    select id into v_head from public.staff where school_id = s.id and role = 'principal' order by id limit 1;
    if v_head is null then select id into v_head from public.staff where school_id = s.id and role = 'office' order by id limit 1; end if;
    select id into v_t from public.position_title where school_id = s.id and name = case when s.uni then 'Director' else 'Principal' end;
    if v_head is not null then insert into public.staff_position (school_id, staff_id, title_id, starts_on) values (s.id, v_head, v_t, date '2024-06-01'); end if;
    -- teachers in id order: the first is Dean, the next ones Heads of Department, the last CoE
    select id into v_dean from public.staff where school_id = s.id and role in ('subject_teacher', 'class_teacher') order by id limit 1;
    select id into v_t from public.position_title where school_id = s.id and name = 'Dean';
    insert into public.staff_position (school_id, staff_id, title_id, unit_id, starts_on) values (s.id, v_dean, v_t, v_unit, date '2025-07-01');
    for d in select dp.id, row_number() over (order by dp.id) rn from public.department dp where dp.school_id = s.id loop
      if d.rn = 1 then
        select id into v_t from public.position_title where school_id = s.id and name = 'Director (Department)';
        insert into public.staff_position (school_id, staff_id, title_id, department_id, starts_on) values (s.id, v_dean, v_t, d.id, date '2025-07-01');
      else
        select id into v_t from public.position_title where school_id = s.id and name = 'Head of Department';
        insert into public.staff_position (school_id, staff_id, title_id, department_id, starts_on, acting)
        select s.id, st.id, v_t, d.id, date '2025-07-01', d.rn = 3 from public.staff st where st.school_id = s.id and st.role in ('subject_teacher', 'class_teacher') order by st.id offset d.rn - 1 limit 1;
      end if;
    end loop;
    select id into v_coe from public.staff where school_id = s.id and role in ('subject_teacher', 'class_teacher') order by id desc limit 1;
    select id into v_t from public.position_title where school_id = s.id and name = 'Controller of Examinations';
    insert into public.staff_position (school_id, staff_id, title_id, starts_on) values (s.id, v_coe, v_t, date '2025-01-01');
    insert into public.position_log (school_id, action, staff_id, detail) values (s.id, 'assigned', null, 'Sample positions created');
    n := n + 1;
  end loop;
  raise notice 'seeded % institutions', n;
end $$;
commit;
