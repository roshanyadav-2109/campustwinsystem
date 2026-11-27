-- Revaluation fees and window, and CGPA-to-percentage, set by the exam cell or the office.
begin;
create or replace function public.set_exam_rules(p_reval_fee numeric, p_retotal_fee numeric, p_window int, p_mult numeric, p_offset numeric, p_school bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the exam cell or the office can change these'; end if;
  update public.school set reval_fee = p_reval_fee, retotal_fee = p_retotal_fee, reval_window_days = p_window, cgpa_pct_multiplier = p_mult, cgpa_pct_offset = coalesce(p_offset, 0)
   where id = public.current_school_id();
end $$;
revoke all on function public.set_exam_rules(numeric, numeric, int, numeric, numeric, bigint) from public, anon;
grant execute on function public.set_exam_rules(numeric, numeric, int, numeric, numeric, bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
