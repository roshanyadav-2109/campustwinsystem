-- PayU, Cashfree and Easebuzz can be switched on (each needs its public key saved, besides its secret in the vault).
begin;
create or replace function public.set_active_gateway(p_gateway bigint, p_connected text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); g public.payment_gateway; d record;
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  if p_gateway is not null then
    select * into g from public.payment_gateway where id = p_gateway and school_id = v_school;
    if g.id is null then raise exception 'Unknown gateway'; end if;
    if g.provider not in ('test', 'razorpay', 'payu', 'cashfree', 'easebuzz') then raise exception 'This gateway is not connected yet'; end if;
    if g.provider <> 'test' and g.secret_id is null then raise exception 'Save the gateway keys first'; end if;
    if g.provider = 'razorpay' and coalesce(g.config ->> 'key_id', '') = '' then raise exception 'Save the gateway keys first'; end if;
    if g.provider in ('payu', 'easebuzz') and coalesce(g.config ->> 'key', '') = '' then raise exception 'Save the gateway keys first'; end if;
    if g.provider = 'cashfree' and coalesce(g.config ->> 'app_id', '') = '' then raise exception 'Save the gateway keys first'; end if;
    if g.mode = 'test' and not coalesce((select is_sample from public.school where id = v_school), false) then
      raise exception 'Test mode is for trying the gateway out: switch on the live gateway for parents';
    end if;
    if g.mode = 'live' then
      select * into d from public.policy_details(v_school);
      if coalesce(d.address, '') = '' or (coalesce(d.phone, '') = '' and coalesce(d.email, '') = '') then
        raise exception 'Fill the gateway application first (address and phone or email): your policy pages show them';
      end if;
    end if;
  end if;
  update public.payment_gateway set active = false, updated_at = now() where school_id = v_school and active and id is distinct from p_gateway;
  if p_gateway is not null then update public.payment_gateway set active = true, updated_at = now() where id = p_gateway; end if;
end $$;
revoke all on function public.set_active_gateway(bigint, text[]) from public, anon;
grant execute on function public.set_active_gateway(bigint, text[]) to authenticated;
commit;
notify pgrst, 'reload schema';
