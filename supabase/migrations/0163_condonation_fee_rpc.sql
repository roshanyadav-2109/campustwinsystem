-- The condonation fee is set by the office, the head or the examinations head.
begin;
create or replace function public.set_condonation_fee(p_fee numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(app.is_admin_scope(), false) or app.has_access('exams_head')) then raise exception 'Only the office, the head or the examinations head can change this'; end if;
  if p_fee is not null and p_fee < 0 then raise exception 'The fee cannot be negative'; end if;
  update public.school set condonation_fee = p_fee where id = public.current_school_id();
end $$;
revoke all on function public.set_condonation_fee(numeric) from public, anon;
grant execute on function public.set_condonation_fee(numeric) to authenticated;
commit;
notify pgrst, 'reload schema';
