-- Online fee payment: a gateway-neutral system. The institution chooses its
-- gateway (BillDesk, Paytm, Razorpay, PayU, Cashfree, CCAvenue ... each is a
-- small connector in src/core/payments/gateways) and enters its own keys,
-- which go to Vault. Until then the TEST gateway completes payments end to
-- end without money moving, so the whole flow can be tried.
--
-- Rules: the amount always comes from the bill in the database, never from the
-- browser; a payment is credited only once (duplicate callbacks and webhooks
-- give one receipt); a failed or abandoned payment leaves the bill unchanged;
-- the receipt number, bill status and Finance posting are the same as for
-- office payments (mode 'online').
begin;

alter table public.fee_payment drop constraint if exists fee_payment_mode_check;
alter table public.fee_payment add constraint fee_payment_mode_check
  check (mode = any (array['cash', 'upi', 'card', 'bank', 'cheque', 'loan', 'online']));

create table if not exists public.payment_gateway_setting (
  school_id   bigint primary key default public.current_school_id() references public.school(id) on delete cascade,
  provider    text not null default 'off' check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  mode        text not null default 'live' check (mode in ('live', 'sandbox')),
  config      jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 4000),   -- non-secret: merchant id, etc.
  secret_id   uuid,
  updated_at  timestamptz not null default now()
);
alter table public.payment_gateway_setting enable row level security;
drop policy if exists pgs_read on public.payment_gateway_setting;
create policy pgs_read on public.payment_gateway_setting for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
drop policy if exists pgs_write on public.payment_gateway_setting;
create policy pgs_write on public.payment_gateway_setting for all to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_office())) with check (school_id = (select public.current_school_id()) and (select app.is_office()));
revoke all on public.payment_gateway_setting from anon, authenticated;
grant select on public.payment_gateway_setting to authenticated;
grant insert (provider, mode, config, updated_at), update (provider, mode, config, updated_at) on public.payment_gateway_setting to authenticated;
grant all on public.payment_gateway_setting to service_role;

create table if not exists public.payment_order (
  id                  bigint generated always as identity primary key,
  school_id           bigint not null references public.school(id) on delete cascade,
  public_id           text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  invoice_id          bigint not null references public.fee_invoice(id) on delete restrict,
  student_id          bigint not null references public.student(id) on delete cascade,
  created_by          uuid not null,
  amount              numeric(12,2) not null check (amount > 0),
  currency            text not null default 'INR',
  provider            text not null,
  provider_order_id   text,
  provider_payment_id text,
  status              text not null default 'created' check (status in ('created', 'paid', 'failed', 'expired')),
  failure_reason      text,
  fee_payment_id      bigint references public.fee_payment(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '30 minutes',
  paid_at             timestamptz
);
create index if not exists idx_payment_order_invoice on public.payment_order (invoice_id, status);
create unique index if not exists uq_payment_order_provider_payment on public.payment_order (provider, provider_payment_id) where provider_payment_id is not null;
alter table public.payment_order enable row level security;
-- the payer sees their own orders; office/principal see the institution's
drop policy if exists po_read on public.payment_order;
create policy po_read on public.payment_order for select to authenticated
  using (school_id = (select public.current_school_id()) and (created_by = auth.uid() or (select app.is_admin_scope())));
revoke all on public.payment_order from anon, authenticated;
grant select on public.payment_order to authenticated;
grant all on public.payment_order to service_role;

-- What the payer may pay online now (their own children's open bills).
create or replace function public.online_payment_available() returns text
language sql stable security definer set search_path = '' as $$
  select provider from public.payment_gateway_setting where school_id = public.current_school_id() and provider <> 'off';
$$;
grant execute on function public.online_payment_available() to authenticated;

-- Start a payment for one bill. The amount is the bill's balance.
create or replace function public.create_payment_order(p_invoice bigint)
returns table (order_public_id text, amount numeric, provider text, mode text, config jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_inv record; v_paid numeric; v_bal numeric; v_gw public.payment_gateway_setting; v_id text;
begin
  select * into v_gw from public.payment_gateway_setting g where g.school_id = v_school and g.provider <> 'off';
  if v_gw.school_id is null then raise exception 'Online payment is not switched on at this institution'; end if;
  select i.id, i.student_id, i.amount, i.status into v_inv from public.fee_invoice i where i.id = p_invoice and i.school_id = v_school for update;
  if v_inv.id is null or not app.can_view_student(v_inv.student_id) then raise exception 'That bill could not be found'; end if;
  if v_inv.status = 'cancelled' then raise exception 'This bill is cancelled'; end if;
  select coalesce(sum(case when p.is_refund then -p.amount else p.amount end), 0) into v_paid from public.fee_payment p where p.invoice_id = v_inv.id;
  v_bal := round(v_inv.amount - v_paid, 2);
  if v_bal <= 0 then raise exception 'This bill is already paid'; end if;
  -- one open attempt per bill at a time: an older one expires
  update public.payment_order po set status = 'expired' where po.invoice_id = v_inv.id and po.status = 'created';
  if (select count(*) from public.payment_order po where po.created_by = auth.uid() and po.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many payment attempts. Please try again later';
  end if;
  insert into public.payment_order (school_id, invoice_id, student_id, created_by, amount, provider)
  values (v_school, v_inv.id, v_inv.student_id, auth.uid(), v_bal, v_gw.provider)
  returning public_id into v_id;
  return query select v_id, v_bal, v_gw.provider, v_gw.mode, v_gw.config;
end $$;
revoke all on function public.create_payment_order(bigint) from public, anon;
grant execute on function public.create_payment_order(bigint) to authenticated;

-- For the server's gateway connector: the order, the institution's gateway
-- config and its keys (service role only).
create or replace function public.payment_order_for_gateway(p_public_id text)
returns table (id bigint, school_id bigint, public_id text, amount numeric, currency text, status text, provider text, provider_order_id text,
               mode text, config jsonb, secret text, student_name text, school_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select po.id, po.school_id, po.public_id, po.amount, po.currency, po.status, po.provider, po.provider_order_id,
         g.mode, g.config,
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.secret_id and ds.name like 'pay:' || po.school_id || ':%'),
         st.full_name, s.name, po.expires_at
  from public.payment_order po
  join public.payment_gateway_setting g on g.school_id = po.school_id
  join public.student st on st.id = po.student_id
  join public.school s on s.id = po.school_id
  where po.public_id = p_public_id;
$$;
revoke all on function public.payment_order_for_gateway(text) from public, anon, authenticated;
grant execute on function public.payment_order_for_gateway(text) to service_role;

create or replace function public.set_payment_order_ref(p_public_id text, p_provider_order_id text) returns void
language sql security definer set search_path = '' as $$
  update public.payment_order set provider_order_id = left(p_provider_order_id, 120) where public_id = p_public_id and status = 'created';
$$;
revoke all on function public.set_payment_order_ref(text, text) from public, anon, authenticated;
grant execute on function public.set_payment_order_ref(text, text) to service_role;

-- The gateway confirmed the money (after the connector verified its
-- signature). Idempotent: a second confirmation returns the same receipt.
create or replace function public.complete_payment_order(p_public_id text, p_provider_payment_id text, p_amount numeric)
returns table (ok boolean, receipt_no text, message text)
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order; v_pay bigint; v_receipt text;
begin
  select * into o from public.payment_order where public_id = p_public_id for update;
  if o.id is null then return query select false, null::text, 'Unknown payment'; return; end if;
  if o.status = 'paid' then
    return query select true, (select p.receipt_no from public.fee_payment p where p.id = o.fee_payment_id), 'Already recorded'; return;
  end if;
  if round(p_amount, 2) <> o.amount then
    update public.payment_order set status = 'failed', failure_reason = 'Amount did not match' where id = o.id;
    return query select false, null::text, 'Amount did not match the bill'; return;
  end if;
  -- even if the order expired (slow bank), money that arrived is credited
  insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode, reference, note)
  values (o.school_id, o.invoice_id, o.amount, (now() at time zone 'Asia/Kolkata')::date, 'online',
          left(o.provider || ' ' || coalesce(p_provider_payment_id, ''), 80), 'Paid online')
  returning id, fee_payment.receipt_no into v_pay, v_receipt;
  update public.payment_order set status = 'paid', paid_at = now(), provider_payment_id = left(p_provider_payment_id, 120), fee_payment_id = v_pay
  where id = o.id;
  return query select true, v_receipt, 'Recorded';
end $$;
revoke all on function public.complete_payment_order(text, text, numeric) from public, anon, authenticated;
grant execute on function public.complete_payment_order(text, text, numeric) to service_role;

create or replace function public.fail_payment_order(p_public_id text, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.payment_order set status = 'failed', failure_reason = left(p_reason, 200) where public_id = p_public_id and status = 'created';
$$;
revoke all on function public.fail_payment_order(text, text) from public, anon, authenticated;
grant execute on function public.fail_payment_order(text, text) to service_role;

create or replace function public.set_payment_secret(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id uuid;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change payment settings'; end if;
  select secret_id into v_id from public.payment_gateway_setting where school_id = v_school;
  if v_id is null then
    v_id := vault.create_secret(p_secret, 'pay:' || v_school || ':' || gen_random_uuid(), 'CampusTwin payment gateway keys');
    insert into public.payment_gateway_setting (school_id, secret_id) values (v_school, v_id)
      on conflict (school_id) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_id, p_secret);
    update public.payment_gateway_setting set updated_at = now() where school_id = v_school;
  end if;
end $$;
revoke all on function public.set_payment_secret(text) from public, anon;
grant execute on function public.set_payment_secret(text) to authenticated;

-- abandoned attempts expire (every 10 minutes)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'payment-orders-expire';
  perform cron.schedule('payment-orders-expire', '*/10 * * * *', $q$update public.payment_order set status = 'expired' where status = 'created' and expires_at < now()$q$);
end $$;
commit;
