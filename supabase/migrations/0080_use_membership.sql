-- Moves a person's "last used" institution to one of their own memberships
-- (staff before parent before student there). Called when they open another
-- institution's website or switch. Refuses institutions they do not belong to.
create or replace function public.use_membership(p_school bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.person_membership;
begin
  select * into m from public.person_membership x where x.user_id = auth.uid() and x.school_id = p_school
   order by case x.role when 'staff' then 1 when 'guardian' then 2 else 3 end limit 1;
  if not found then return false; end if;
  update public.profile p set school_id = m.school_id, role = m.role::public.profile_role,
         staff_id = m.staff_id, guardian_id = m.guardian_id, student_id = m.student_id, active_campus_id = null
   where p.id = auth.uid() and p.university_id is null
     and (p.school_id, p.role::text, coalesce(p.staff_id, 0), coalesce(p.guardian_id, 0), coalesce(p.student_id, 0))
         is distinct from (m.school_id, m.role, coalesce(m.staff_id, 0), coalesce(m.guardian_id, 0), coalesce(m.student_id, 0));
  return true;
end $$;
revoke all on function public.use_membership(bigint) from public, anon;
grant execute on function public.use_membership(bigint) to authenticated;
