-- The exam cell (examinations head) may set the attendance lock and holds.
begin;
create or replace function public.set_attendance_rules(p_mode text, p_days int, p_minimum numeric, p_floor numeric, p_hold_fees boolean, p_chain jsonb, p_cutoff date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not (coalesce(app.is_admin_scope(), false) or app.has_access('exams_head')) then raise exception 'Only the office, the principal or the examinations head can change these rules'; end if;
  if p_floor is not null and p_floor > p_minimum then raise exception 'The floor must be below the minimum attendance'; end if;
  update public.school set attendance_lock_mode = p_mode, attendance_edit_days = p_days, attendance_minimum = p_minimum, condone_floor = p_floor,
    hold_results_fees = p_hold_fees, relax_chain = p_chain where id = v_school;
  update public.semester set attendance_cutoff = p_cutoff where school_id = v_school and is_current;
end $$;
commit;
