-- School admin's Logins list: everyone who belongs to this institution, even
-- when they last used another one (memberships, 0078).
create or replace function public.my_school_logins()
returns table (full_name text, role text, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.full_name, g.full_name, st.full_name, p.full_name), m.role, u.email::text, m.created_at, u.last_sign_in_at
  from public.person_membership m
  join auth.users u on u.id = m.user_id
  left join public.profile p on p.id = m.user_id
  left join public.staff s on s.id = m.staff_id
  left join public.guardian g on g.id = m.guardian_id
  left join public.student st on st.id = m.student_id
  where app.is_admin_scope() and m.school_id = public.current_school_id()
  order by u.last_sign_in_at desc nulls last;
$$;
