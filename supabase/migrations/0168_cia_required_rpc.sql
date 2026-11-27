-- Whether results wait for the Head of Department's sign-off of internal marks.
begin;
create or replace function public.set_cia_signoff_required(p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the exam cell or the office can change this'; end if;
  update public.school set require_cia_signoff = coalesce(p_required, false) where id = public.current_school_id();
end $$;
revoke all on function public.set_cia_signoff_required(boolean) from public, anon;
grant execute on function public.set_cia_signoff_required(boolean) to authenticated;
grant execute on function public.exam_cell_overview() to authenticated;
commit;
notify pgrst, 'reload schema';
