-- Restores the single-profile definitions replaced by 0078.
begin;
CREATE OR REPLACE FUNCTION app.my_guardian_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select guardian_id from public.profile where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION app.my_owned_students()
 RETURNS SETOF bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select student_id from public.profile where id = auth.uid() and role = 'student'
  union
  select gs.student_id from public.profile p
    join public.guardian_student gs on gs.guardian_id = p.guardian_id
  where p.id = auth.uid() and p.role = 'guardian';
$function$
;

CREATE OR REPLACE FUNCTION app.my_role()
 RETURNS profile_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select role from public.profile where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION app.my_staff_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select staff_id from public.profile where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION app.my_staff_role()
 RETURNS staff_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.role from public.profile p join public.staff s on s.id = p.staff_id
  where p.id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION app.owns_student(p_student bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.profile pr where pr.id = auth.uid()
      and pr.role = 'student' and pr.student_id = p_student
  ) or exists (
    select 1 from public.profile pr
      join public.guardian_student gs on gs.guardian_id = pr.guardian_id
    where pr.id = auth.uid() and pr.role = 'guardian' and gs.student_id = p_student
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_school_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(active_campus_id, school_id) from public.profile where id = auth.uid()
$function$
;
commit;
