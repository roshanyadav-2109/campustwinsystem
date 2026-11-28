-- After review of 0196:
--   * a gateway's test mode is only for sample institutions (test payments must never clear a real bill)
--   * only connected gateways can be switched on (the list is here, not from the caller)
--   * a live gateway is switched on only when the policy pages have an address and a phone or email
--   * keys and key id are saved together; a Razorpay order, once made, is kept (two tabs never make two)
--   * deleting a gateway or the application deletes its secrets from the vault
--   * the policy details are read only by the server
begin;

create or replace function public.set_payment_gateway_keys(p_gateway bigint, p_secret text, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 2000 then raise exception 'Bad settings'; end if;
  perform public.set_payment_gateway_secret(p_gateway, p_secret);
  perform public.set_payment_gateway_config(p_gateway, p_config);
end $$;
revoke all on function public.set_payment_gateway_keys(bigint, text, jsonb) from public, anon;
grant execute on function public.set_payment_gateway_keys(bigint, text, jsonb) to authenticated;

create or replace function public.set_active_gateway(p_gateway bigint, p_connected text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); g public.payment_gateway; d record;
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  if p_gateway is not null then
    select * into g from public.payment_gateway where id = p_gateway and school_id = v_school;
    if g.id is null then raise exception 'Unknown gateway'; end if;
    if g.provider not in ('test', 'razorpay') then raise exception 'This gateway is not connected yet'; end if;
    if g.provider <> 'test' and g.secret_id is null then raise exception 'Save the gateway keys first'; end if;
    if g.provider = 'razorpay' and coalesce(g.config ->> 'key_id', '') = '' then raise exception 'Save the gateway keys first'; end if;
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

-- a real institution's test-mode gateway is switched off
update public.payment_gateway g set active = false, updated_at = now()
where g.active and g.mode = 'test' and not coalesce((select is_sample from public.school s where s.id = g.school_id), false);

-- the gateway's order reference is set once
create or replace function public.set_payment_order_ref(p_public_id text, p_provider_order_id text) returns void
language sql security definer set search_path = '' as $$
  update public.payment_order set provider_order_id = left(p_provider_order_id, 120)
  where public_id = p_public_id and status in ('created', 'pending') and provider_order_id is null;
$$;
revoke all on function public.set_payment_order_ref(text, text) from public, anon, authenticated;
grant execute on function public.set_payment_order_ref(text, text) to service_role;

-- secrets go with their gateway / application
create or replace function public.drop_vault_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
revoke all on function public.drop_vault_secret() from public, anon, authenticated;
drop trigger if exists trg_payment_gateway_secret on public.payment_gateway;
create trigger trg_payment_gateway_secret after delete on public.payment_gateway for each row execute function public.drop_vault_secret();
drop trigger if exists trg_payment_profile_secret on public.payment_profile;
create trigger trg_payment_profile_secret after delete on public.payment_profile for each row execute function public.drop_vault_secret();

revoke execute on function public.policy_details(bigint) from anon, authenticated;
grant execute on function public.policy_details(bigint) to service_role;
commit;
notify pgrst, 'reload schema';
