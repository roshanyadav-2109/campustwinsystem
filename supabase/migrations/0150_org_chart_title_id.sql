-- The chart carries each position's title id (for acting cover and vacancies).
begin;
create or replace function public.org_chart() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'parent_id', u.parent_id, 'name', u.name, 'kind', u.kind, 'code', u.code) order by u.name)
                       from public.academic_unit u where u.school_id = public.current_school_id()), '[]'),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'unit_id', d.unit_id, 'name', d.name, 'code', d.code) order by d.name)
                       from public.department d where d.school_id = public.current_school_id()), '[]'),
    'programmes', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'department_id', g.department_id, 'name', g.name) order by g.name)
                       from public.programme g where g.school_id = public.current_school_id()), '[]'),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title_id', p.title_id, 'title', t.name, 'type', t.access_type, 'level', t.scope_level, 'sort', t.sort,
                       'staff_id', p.staff_id, 'holder', s.full_name, 'acting', p.acting, 'since', p.starts_on, 'until', p.ends_on,
                       'unit_id', p.unit_id, 'department_id', p.department_id, 'programme_id', p.programme_id,
                       'elsewhere', p.school_id <> public.current_school_id()) order by t.sort, t.name)
                       from (select * from public.positions_here()
                             union select x.* from public.staff_position x where x.school_id = public.current_school_id()
                               and x.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (x.ends_on is null or x.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) p
                       join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id
                       where t.access_type not in ('confidential', 'evaluator', 'moderator', 'exam_centre')), '[]'),
    'titles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.access_type, 'level', t.scope_level, 'sort', t.sort) order by t.sort)
                       from public.position_title t where t.school_id = public.current_school_id() and t.active
                         and t.access_type in ('governing', 'head', 'deputy_head', 'registrar', 'exams_head', 'finance_head', 'student_affairs', 'dean', 'dept_head', 'programme_coord')), '[]'))
  where public.is_higher_ed(public.current_school_id()) and app.my_staff_id() is not null;
$$;
commit;
