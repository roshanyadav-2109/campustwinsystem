-- The fee for a photocopy of an answer script, set with the other revaluation fees.
begin;
create or replace function public.set_photocopy_fee(p_fee numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or the office) can change this'; end if;
  if p_fee is not null and p_fee < 0 then raise exception 'The fee cannot be negative'; end if;
  update public.school set photocopy_fee = nullif(round(p_fee, 2), 0) where id = public.current_school_id();
end $$;
revoke all on function public.set_photocopy_fee(numeric) from public, anon;
grant execute on function public.set_photocopy_fee(numeric) to authenticated;
commit;
notify pgrst, 'reload schema';
