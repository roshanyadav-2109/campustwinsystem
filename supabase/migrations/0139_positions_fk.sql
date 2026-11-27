-- Deleting an institution removes its positions and titles together: checks
-- at the end of the statement (no action) rather than at once (restrict).
begin;
alter table public.staff_position drop constraint if exists staff_position_title_id_fkey,
  add constraint staff_position_title_id_fkey foreign key (title_id) references public.position_title(id) on delete no action;
alter table public.staff_position drop constraint if exists staff_position_unit_id_fkey,
  add constraint staff_position_unit_id_fkey foreign key (unit_id) references public.academic_unit(id) on delete no action;
alter table public.staff_position drop constraint if exists staff_position_department_id_fkey,
  add constraint staff_position_department_id_fkey foreign key (department_id) references public.department(id) on delete no action;
alter table public.staff_position drop constraint if exists staff_position_programme_id_fkey,
  add constraint staff_position_programme_id_fkey foreign key (programme_id) references public.programme(id) on delete no action;
commit;
