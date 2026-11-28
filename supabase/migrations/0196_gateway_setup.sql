-- Payment gateway setup per institution (Razorpay first).
--   Each institution has its own merchant account: its public key id sits in the gateway's config; the key secret
--   and the webhook secret go to Vault (never readable by the app's users, never shown again).
--   The gateway application details (legal name, contact, bank, refund rules) are kept per institution; the PAN and
--   the bank account number go to Vault too, and only their last four digits stay readable.
--   The institution's policy pages (privacy, terms, refund, contact) read only the public part.
begin;

-- the finance head may manage payment settings (fees and payments are theirs, 0188)
create or replace function public.set_payment_gateway_secret(p_gateway bigint, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id uuid;
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  select secret_id into v_id from public.payment_gateway where id = p_gateway and school_id = v_school;
  if not found then raise exception 'Unknown gateway'; end if;
  if v_id is null then
    v_id := vault.create_secret(p_secret, 'pay:' || v_school || ':' || p_gateway || ':' || gen_random_uuid(), 'CampusTwin payment gateway keys');
    update public.payment_gateway set secret_id = v_id, updated_at = now() where id = p_gateway;
  else
    perform vault.update_secret(v_id, p_secret);
    update public.payment_gateway set updated_at = now() where id = p_gateway;
  end if;
  insert into public.payment_event (school_id, kind, detail) values (v_school, 'keys_changed', jsonb_build_object('gateway', p_gateway, 'by', app.my_staff_id()));
end $$;

-- public settings of a gateway (e.g. Razorpay's key id, which the payer's browser needs anyway)
create or replace function public.set_payment_gateway_config(p_gateway bigint, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  if jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 2000 then raise exception 'Bad settings'; end if;
  update public.payment_gateway set config = config || p_config, updated_at = now() where id = p_gateway and school_id = v_school;
  if not found then raise exception 'Unknown gateway'; end if;
end $$;
revoke all on function public.set_payment_gateway_config(bigint, jsonb) from public, anon;
grant execute on function public.set_payment_gateway_config(bigint, jsonb) to authenticated;

-- the keys of one gateway, for the server's "test the connection" (service role only; the app checks who asks)
create or replace function public.payment_gateway_keys(p_gateway bigint, p_school bigint)
returns table (provider text, mode text, config jsonb, secret text)
language sql stable security definer set search_path = '' as $$
  select g.provider, g.mode, g.config,
    (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.secret_id and ds.name like 'pay:' || g.school_id || ':' || g.id || ':%')
  from public.payment_gateway g where g.id = p_gateway and g.school_id = p_school;
$$;
revoke all on function public.payment_gateway_keys(bigint, bigint) from public, anon, authenticated;
grant execute on function public.payment_gateway_keys(bigint, bigint) to service_role;

-- switching a gateway on: connected, keys saved, and (Razorpay) its key id set
create or replace function public.set_active_gateway(p_gateway bigint, p_connected text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); g public.payment_gateway;
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  if p_gateway is not null then
    select * into g from public.payment_gateway where id = p_gateway and school_id = v_school;
    if g.id is null then raise exception 'Unknown gateway'; end if;
    if not (g.provider = any(p_connected)) then raise exception 'This gateway is not connected yet'; end if;
    if g.provider <> 'test' and g.secret_id is null then raise exception 'Save the gateway keys first'; end if;
    if g.provider = 'razorpay' and coalesce(g.config ->> 'key_id', '') = '' then raise exception 'Save the gateway keys first'; end if;
  end if;
  update public.payment_gateway set active = false, updated_at = now() where school_id = v_school and active and id is distinct from p_gateway;
  if p_gateway is not null then update public.payment_gateway set active = true, updated_at = now() where id = p_gateway; end if;
end $$;
revoke all on function public.set_active_gateway(bigint, text[]) from public, anon;
grant execute on function public.set_active_gateway(bigint, text[]) to authenticated;

-- ---------- the gateway application (one per institution) ----------
create table if not exists public.payment_profile (
  school_id        bigint primary key references public.school(id) on delete cascade,
  legal_name       text check (legal_name is null or char_length(legal_name) <= 160),
  entity_type      text check (entity_type is null or entity_type in ('trust', 'society', 'company', 'section8', 'government', 'proprietor', 'partnership', 'other')),
  registration_no  text check (registration_no is null or char_length(registration_no) <= 60),
  gstin            text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan_last4        text check (pan_last4 is null or char_length(pan_last4) = 4),
  contact_name     text check (contact_name is null or char_length(contact_name) <= 100),
  contact_phone    text check (contact_phone is null or char_length(contact_phone) <= 20),
  contact_email    text check (contact_email is null or char_length(contact_email) <= 200),
  address          text check (address is null or char_length(address) <= 400),
  expected_monthly numeric(14,2) check (expected_monthly is null or expected_monthly >= 0),
  bank_holder      text check (bank_holder is null or char_length(bank_holder) <= 120),
  bank_ifsc        text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_last4       text check (bank_last4 is null or char_length(bank_last4) = 4),
  secret_id        uuid,                                    -- Vault: {"pan": ..., "bank_account": ...}
  -- refund and cancellation rules shown on the refund policy page
  admission_refundable boolean not null default false,
  refund_days      int not null default 15 check (refund_days between 1 and 90),
  hostel_rule      text check (hostel_rule is null or char_length(hostel_rule) <= 400),
  transport_rule   text check (transport_rule is null or char_length(transport_rule) <= 400),
  extra_terms      text check (extra_terms is null or char_length(extra_terms) <= 2000),
  grievance_name   text check (grievance_name is null or char_length(grievance_name) <= 100),
  updated_at       timestamptz not null default now()
);
alter table public.payment_profile enable row level security;
drop policy if exists pp_read on public.payment_profile;
create policy pp_read on public.payment_profile for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_finance()));
revoke all on public.payment_profile from anon, authenticated;
grant select (school_id, legal_name, entity_type, registration_no, gstin, pan_last4, contact_name, contact_phone, contact_email, address, expected_monthly,
              bank_holder, bank_ifsc, bank_last4, admission_refundable, refund_days, hostel_rule, transport_rule, extra_terms, grievance_name, updated_at)
  on public.payment_profile to authenticated;
grant all on public.payment_profile to service_role;

create or replace function public.save_payment_profile(p jsonb, p_pan text default null, p_bank_account text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id uuid; v_sec jsonb; v_pan text := upper(nullif(trim(p_pan), '')); v_acc text := nullif(regexp_replace(coalesce(p_bank_account, ''), '\s', '', 'g'), '');
begin
  if not coalesce(app.is_finance(), false) then raise exception 'Only the office or the finance head can change payment settings'; end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'The PAN should look like ABCDE1234F'; end if;
  if v_acc is not null and v_acc !~ '^[0-9]{6,18}$' then raise exception 'The bank account number is 6 to 18 digits'; end if;
  insert into public.payment_profile (school_id) values (v_school) on conflict (school_id) do nothing;
  update public.payment_profile set
    legal_name = nullif(trim(p ->> 'legal_name'), ''), entity_type = nullif(p ->> 'entity_type', ''), registration_no = nullif(trim(p ->> 'registration_no'), ''),
    gstin = nullif(upper(trim(p ->> 'gstin')), ''), contact_name = nullif(trim(p ->> 'contact_name'), ''), contact_phone = nullif(trim(p ->> 'contact_phone'), ''),
    contact_email = nullif(lower(trim(p ->> 'contact_email')), ''), address = nullif(trim(p ->> 'address'), ''),
    expected_monthly = nullif(p ->> 'expected_monthly', '')::numeric, bank_holder = nullif(trim(p ->> 'bank_holder'), ''), bank_ifsc = nullif(upper(trim(p ->> 'bank_ifsc')), ''),
    admission_refundable = coalesce((p ->> 'admission_refundable')::boolean, false), refund_days = coalesce(nullif(p ->> 'refund_days', '')::int, 15),
    hostel_rule = nullif(trim(p ->> 'hostel_rule'), ''), transport_rule = nullif(trim(p ->> 'transport_rule'), ''), extra_terms = nullif(trim(p ->> 'extra_terms'), ''),
    grievance_name = nullif(trim(p ->> 'grievance_name'), ''), updated_at = now()
  where school_id = v_school;
  -- PAN and bank account number: only into Vault; a blank field keeps what is saved
  if v_pan is not null or v_acc is not null then
    select secret_id into v_id from public.payment_profile where school_id = v_school;
    v_sec := coalesce((select ds.decrypted_secret::jsonb from vault.decrypted_secrets ds where ds.id = v_id and ds.name like 'payprof:' || v_school || ':%'), '{}'::jsonb);
    if v_pan is not null then v_sec := v_sec || jsonb_build_object('pan', v_pan); end if;
    if v_acc is not null then v_sec := v_sec || jsonb_build_object('bank_account', v_acc); end if;
    if v_id is null then
      v_id := vault.create_secret(v_sec::text, 'payprof:' || v_school || ':' || gen_random_uuid(), 'CampusTwin gateway application: PAN and bank account');
    else
      perform vault.update_secret(v_id, v_sec::text);
    end if;
    update public.payment_profile set secret_id = v_id,
      pan_last4 = case when v_pan is not null then right(v_pan, 4) else pan_last4 end,
      bank_last4 = case when v_acc is not null then right(v_acc, 4) else bank_last4 end where school_id = v_school;
  end if;
  insert into public.payment_event (school_id, kind, detail) values (v_school, 'profile_changed', jsonb_build_object('by', app.my_staff_id()));
end $$;
revoke all on function public.save_payment_profile(jsonb, text, text) from public, anon;
grant execute on function public.save_payment_profile(jsonb, text, text) to authenticated;

-- the public part, for the institution's policy pages (no PAN, no bank details)
create or replace function public.policy_details(p_school bigint)
returns table (name text, legal_name text, entity_type text, address text, phone text, email text, website text, gstin text,
               admission_refundable boolean, refund_days int, hostel_rule text, transport_rule text, extra_terms text, grievance_name text, higher_ed boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.name, coalesce(pp.legal_name, s.name), pp.entity_type, coalesce(pp.address, s.address), coalesce(pp.contact_phone, s.phone), coalesce(pp.contact_email, s.email), s.website, pp.gstin,
    coalesce(pp.admission_refundable, false), coalesce(pp.refund_days, 15), pp.hostel_rule, pp.transport_rule, pp.extra_terms, pp.grievance_name,
    public.is_higher_ed(s.id), coalesce(pp.updated_at, s.created_at)
  from public.school s left join public.payment_profile pp on pp.school_id = s.id where s.id = p_school;
$$;
revoke all on function public.policy_details(bigint) from public;
grant execute on function public.policy_details(bigint) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
