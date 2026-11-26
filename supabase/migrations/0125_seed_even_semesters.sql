-- Demo data only: spread each year's sample courses over both semesters
-- (the first seed put them all in the odd semester).
begin;
with ranked as (
  select pc.id, pc.semester_no, row_number() over (partition by pc.programme_id, pc.semester_no order by c.code) rn
  from public.programme_course pc join public.course c on c.id = pc.course_id join public.school s on s.id = pc.school_id
  where s.is_sample and pc.elective_group is null and pc.semester_no % 2 = 1
    and not exists (select 1 from public.course_registration r where r.programme_course_id = pc.id))
update public.programme_course pc set semester_no = r.semester_no + 1
from ranked r where pc.id = r.id and r.rn % 2 = 0;
commit;
