-- Whether an institution is a school or a college. Campuses of a university
-- are higher education whatever this says. Features for higher education only
-- (fee letters on request, education-loan payments) follow this.
alter table public.school add column if not exists institution_type text not null default 'school'
  check (institution_type in ('school', 'college'));
-- the fictional sample colleges
update public.school set institution_type = 'college'
 where institution_type = 'school' and (name ilike '%college%' or name ilike '%institute of%');
