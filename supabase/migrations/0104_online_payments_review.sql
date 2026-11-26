-- Online fee payment, after the product + CTO review of 0098. The tables had no
-- rows yet, so they are rebuilt.
-- * Several gateways per institution (one active for new payments), each with
--   its own keys; every settings change is recorded.
-- * Orders keep the gateway, its mode (live / test) and the payer's contact.
-- * Never credited twice: an open attempt for the same bill and amount is
--   reused; confirming locks the bill and re-checks the balance; money that
--   arrives for a bill already paid (cash at the counter meanwhile, a second
--   tab) is kept as "refund due" for the office, never lost.
-- * A different amount or payment id goes to "review" with both recorded.
-- * Test gateway: receipts say TEST, no money, and are never posted to Finance.
-- * Statuses: created, pending (bank processing), paid, failed, expired, review.
-- * Refunds through the gateway write a refund receipt; chargebacks too.
-- * Reconciliation: method, gateway fee, settlement reference and date, and
--   an append-only event log of everything the gateway said.
-- * Only the student's own parent or the student can start a payment.
begin;
do $$ begin
  if exists (select 1 from public.payment_order) or exists (select 1 from public.payment_gateway_setting) then
    raise exception 'payment tables have data; write a migration instead of rebuilding';
  end if;
end $$;
drop function if exists public.payment_order_for_gateway(text);
drop function if exists public.set_payment_order_ref(text, text);
drop function if exists public.complete_payment_order(text, text, numeric);
drop function if exists public.fail_payment_order(text, text);
drop table if exists public.payment_order cascade;
drop table if exists public.payment_gateway_setting cascade;

create table public.payment_gateway (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  provider    text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text check (label is null or char_length(label) <= 60),
  mode        text not null default 'live' check (mode in ('live', 'test')),
  active      boolean not null default false,
  config      jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 4000),
  secret_id   uuid,
  updated_at  timestamptz not null default now(),
  unique (school_id, provider, mode),
  check (provider <> 'test' or mode = 'test')
);
create unique index uq_payment_gateway_active on public.payment_gateway (school_id) where active;
alter table public.payment_gateway enable row level security;
create policy pg_read on public.payment_gateway for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
create policy pg_write on public.payment_gateway for all to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_office())) with check (school_id = (select public.current_school_id()) and (select app.is_office()));
revoke all on public.payment_gateway from anon, authenticated;
grant select, delete on public.payment_gateway to authenticated;
grant insert (provider, label, mode, active, config, updated_at), update (label, active, config, updated_at) on public.payment_gateway to authenticated;
grant all on public.payment_gateway to service_role;
drop trigger if exists trg_log_change on public.payment_gateway;
create trigger trg_log_change after insert or delete or update on public.payment_gateway for each row execute function public.log_change('Payment gateway');

create table public.payment_order (
  id                  bigint generated always as identity primary key,
  school_id           bigint not null references public.school(id) on delete cascade,
  public_id           text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  invoice_id          bigint not null references public.fee_invoice(id) on delete restrict,
  student_id          bigint not null references public.student(id) on delete cascade,
  gateway_id          bigint not null references public.payment_gateway(id) on delete restrict,
  provider            text not null,
  mode                text not null check (mode in ('live', 'test')),
  created_by          uuid not null,
  payer_name          text, payer_email text, payer_phone text,
  amount              numeric(12,2) not null check (amount > 0),
  currency            text not null default 'INR',
  provider_order_id   text,
  provider_payment_id text,
  status              text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'expired', 'review')),
  failure_reason      text,
  received_amount     numeric(12,2),
  credited_amount     numeric(12,2),
  refund_due          numeric(12,2) not null default 0,
  refunded_amount     numeric(12,2) not null default 0,
  method              text, gateway_fee numeric(12,2), settlement_ref text, settled_on date,
  fee_payment_id      bigint references public.fee_payment(id) on delete restrict,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '30 minutes',
  paid_at             timestamptz
);
create index idx_payment_order_invoice on public.payment_order (invoice_id, status);
create index idx_payment_order_school on public.payment_order (school_id, created_at desc);
create unique index uq_payment_order_provider_order on public.payment_order (provider, provider_order_id) where provider_order_id is not null;
create unique index uq_payment_order_provider_payment on public.payment_order (provider, provider_payment_id) where provider_payment_id is not null;
alter table public.payment_order enable row level security;
create policy po_read on public.payment_order for select to authenticated
  using (school_id = (select public.current_school_id()) and (created_by = auth.uid() or (select app.is_admin_scope())));
revoke all on public.payment_order from anon, authenticated;
grant select on public.payment_order to authenticated;
grant all on public.payment_order to service_role;

create table public.payment_event (
  id         bigint generated always as identity primary key,
  school_id  bigint not null references public.school(id) on delete cascade,
  order_id   bigint references public.payment_order(id) on delete cascade,
  kind       text not null check (char_length(kind) <= 40),
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index idx_payment_event_order on public.payment_event (order_id, at);
alter table public.payment_event enable row level security;
create policy pe_read on public.payment_event for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
revoke all on public.payment_event from anon, authenticated;
grant select on public.payment_event to authenticated;
grant all on public.payment_event to service_role;
create or replace function public.payment_event_append_only() returns trigger language plpgsql as $$
begin raise exception 'The payment log cannot be changed'; end $$;
create trigger trg_payment_event_append_only before update or delete on public.payment_event for each row execute function public.payment_event_append_only();

-- fee_payment: mark test receipts; they are never posted to Finance
alter table public.fee_payment add column if not exists is_test boolean not null default false;

-- ---------- functions ----------
drop function if exists public.online_payment_available();
create function public.online_payment_available() returns table (provider text, mode text)
language sql stable security definer set search_path = '' as $$
  select g.provider, g.mode from public.payment_gateway g where g.school_id = public.current_school_id() and g.active;
$$;
grant execute on function public.online_payment_available() to authenticated;

drop function if exists public.create_payment_order(bigint);
create function public.create_payment_order(p_invoice bigint)
returns table (order_public_id text, amount numeric, provider text, mode text)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_inv record; v_paid numeric; v_bal numeric; v_gw public.payment_gateway; o public.payment_order;
  v_name text; v_email text; v_phone text;
begin
  select * into v_gw from public.payment_gateway g where g.school_id = v_school and g.active;
  if v_gw.id is null then raise exception 'Online payment is not switched on at this institution'; end if;
  select i.id, i.student_id, i.amount, i.status into v_inv from public.fee_invoice i where i.id = p_invoice and i.school_id = v_school for update;
  if v_inv.id is null or not app.owns_student(v_inv.student_id) then raise exception 'That bill could not be found'; end if;
  if v_inv.status = 'cancelled' then raise exception 'This bill is cancelled'; end if;
  select coalesce(sum(case when p.is_refund then -p.amount else p.amount end), 0) into v_paid from public.fee_payment p where p.invoice_id = v_inv.id;
  v_bal := round(v_inv.amount - v_paid, 2);
  if v_bal <= 0 then raise exception 'This bill is already paid'; end if;
  if exists (select 1 from public.payment_order po where po.invoice_id = v_inv.id and po.status = 'pending') then
    raise exception 'A payment for this bill is still being processed by the bank. Please check again in a few minutes';
  end if;
  -- reuse an open attempt for the same amount (two tabs, two parents)
  select * into o from public.payment_order po where po.invoice_id = v_inv.id and po.status = 'created' and po.amount = v_bal
     and po.gateway_id = v_gw.id and po.expires_at > now() + interval '5 minutes' order by po.id desc limit 1;
  if o.id is not null then return query select o.public_id, o.amount, o.provider, o.mode; return; end if;
  if (select count(*) from public.payment_order po where po.created_by = auth.uid() and po.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many payment attempts. Please try again later';
  end if;
  select p.full_name, u.email, coalesce(g.phone, st.phone) into v_name, v_email, v_phone
    from public.profile p join auth.users u on u.id = p.id
    left join public.guardian g on g.id = p.guardian_id left join public.student st on st.id = p.student_id
   where p.id = auth.uid();
  insert into public.payment_order (school_id, invoice_id, student_id, gateway_id, provider, mode, created_by, payer_name, payer_email, payer_phone, amount)
  values (v_school, v_inv.id, v_inv.student_id, v_gw.id, v_gw.provider, v_gw.mode, auth.uid(), v_name, v_email, v_phone, v_bal)
  returning * into o;
  insert into public.payment_event (school_id, order_id, kind, detail) values (v_school, o.id, 'created', jsonb_build_object('amount', v_bal));
  return query select o.public_id, o.amount, o.provider, o.mode;
end $$;
revoke all on function public.create_payment_order(bigint) from public, anon;
grant execute on function public.create_payment_order(bigint) to authenticated;

-- for the server's connector (service role): the order with ITS gateway's settings and keys
create function public.payment_order_for_gateway(p_public_id text)
returns table (id bigint, school_id bigint, public_id text, amount numeric, currency text, status text, provider text, mode text,
               provider_order_id text, config jsonb, secret text, payer_name text, payer_email text, payer_phone text,
               student_name text, school_name text, school_slug text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select po.id, po.school_id, po.public_id, po.amount, po.currency, po.status, po.provider, po.mode, po.provider_order_id, g.config,
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.secret_id and ds.name like 'pay:' || po.school_id || ':' || g.id || ':%'),
         po.payer_name, po.payer_email, po.payer_phone, st.full_name, s.name, s.slug, po.expires_at
  from public.payment_order po
  join public.payment_gateway g on g.id = po.gateway_id
  join public.student st on st.id = po.student_id
  join public.school s on s.id = po.school_id
  where po.public_id = p_public_id;
$$;
revoke all on function public.payment_order_for_gateway(text) from public, anon, authenticated;
grant execute on function public.payment_order_for_gateway(text) to service_role;

create function public.payment_log(p_public_id text, p_kind text, p_detail jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.payment_event (school_id, order_id, kind, detail)
  select po.school_id, po.id, left(p_kind, 40), coalesce(p_detail, '{}') from public.payment_order po where po.public_id = p_public_id;
$$;
revoke all on function public.payment_log(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_log(text, text, jsonb) to service_role;

create function public.set_payment_order_ref(p_public_id text, p_provider_order_id text) returns void
language sql security definer set search_path = '' as $$
  update public.payment_order set provider_order_id = left(p_provider_order_id, 120) where public_id = p_public_id and status in ('created', 'pending');
$$;
revoke all on function public.set_payment_order_ref(text, text) from public, anon, authenticated;
grant execute on function public.set_payment_order_ref(text, text) to service_role;

create function public.mark_payment_pending(p_public_id text, p_note text) returns void
language sql security definer set search_path = '' as $$
  update public.payment_order set status = 'pending', failure_reason = left(p_note, 200), expires_at = now() + interval '3 days'
  where public_id = p_public_id and status in ('created', 'expired');
$$;
revoke all on function public.mark_payment_pending(text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_pending(text, text) to service_role;

-- The gateway confirmed money (the connector has verified its signature).
-- Idempotent. Locks the bill, re-checks the balance, never loses money.
create function public.complete_payment_order(p_public_id text, p_provider_payment_id text, p_amount numeric,
                                              p_provider_order_id text default null, p_paid_at timestamptz default null,
                                              p_method text default null, p_gateway_fee numeric default null)
returns table (ok boolean, receipt_no text, message text)
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order; v_inv record; v_paid numeric; v_bal numeric; v_credit numeric; v_pay bigint; v_receipt text; v_day date;
begin
  select * into o from public.payment_order where public_id = p_public_id;
  if o.id is null then return query select false, null::text, 'Unknown payment'; return; end if;
  -- lock the bill first, then the order (same order as create_payment_order)
  select i.id, i.amount, i.status into v_inv from public.fee_invoice i where i.id = o.invoice_id for update;
  select * into o from public.payment_order where id = o.id for update;
  perform public.payment_log(p_public_id, 'confirmed', jsonb_build_object('payment_id', p_provider_payment_id, 'amount', p_amount, 'order_id', p_provider_order_id));

  if o.status = 'paid' then
    if o.provider_payment_id is distinct from left(p_provider_payment_id, 120) then
      update public.payment_order set status = 'review', failure_reason = 'A second payment arrived for the same attempt: ' || left(coalesce(p_provider_payment_id, ''), 60),
        refund_due = refund_due + round(p_amount, 2) where id = o.id;
      return query select false, null::text, 'Second payment kept for review'; return;
    end if;
    return query select true, (select p.receipt_no from public.fee_payment p where p.id = o.fee_payment_id), 'Already recorded'; return;
  end if;
  if o.status = 'review' then return query select false, null::text, 'Waiting for the office to review'; return; end if;
  if p_provider_order_id is not null and o.provider_order_id is not null and p_provider_order_id <> o.provider_order_id then
    update public.payment_order set status = 'review', failure_reason = 'Gateway order did not match', received_amount = round(p_amount, 2),
      provider_payment_id = left(p_provider_payment_id, 120) where id = o.id;
    return query select false, null::text, 'Kept for review: order did not match'; return;
  end if;
  if round(p_amount, 2) < o.amount then
    update public.payment_order set status = 'review', failure_reason = 'Less money arrived than the bill', received_amount = round(p_amount, 2),
      provider_payment_id = left(p_provider_payment_id, 120), refund_due = round(p_amount, 2) where id = o.id;
    return query select false, null::text, 'Kept for review: amount was less than the bill'; return;
  end if;

  -- credit what the bill still needs now; anything more is kept as refund due
  select coalesce(sum(case when p.is_refund then -p.amount else p.amount end), 0) into v_paid from public.fee_payment p where p.invoice_id = o.invoice_id;
  v_bal := greatest(round(v_inv.amount - v_paid, 2), 0);
  if v_inv.status = 'cancelled' then v_bal := 0; end if;
  v_credit := least(o.amount, v_bal);
  v_day := coalesce(p_paid_at, now()) at time zone 'Asia/Kolkata';
  if v_credit > 0 then
    insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode, reference, note, is_test, fin_voucher_id)
    values (o.school_id, o.invoice_id, v_credit, v_day, 'online',
            left(case when o.mode = 'test' then 'TEST ' else '' end || o.provider || ' ' || coalesce(p_provider_payment_id, ''), 80),
            case when o.mode = 'test' then 'TEST payment: no money was received' else 'Paid online' end,
            o.mode = 'test', case when o.mode = 'test' then 0 end)
    returning id, fee_payment.receipt_no into v_pay, v_receipt;
  end if;
  update public.payment_order set
    status = case when v_credit > 0 then 'paid' else 'review' end,
    failure_reason = case when v_credit = 0 then 'The bill was already paid when the money arrived; refund due' end,
    paid_at = coalesce(p_paid_at, now()), provider_payment_id = left(p_provider_payment_id, 120),
    provider_order_id = coalesce(provider_order_id, left(p_provider_order_id, 120)),
    received_amount = round(p_amount, 2), credited_amount = v_credit, refund_due = round(p_amount, 2) - v_credit,
    method = left(p_method, 40), gateway_fee = p_gateway_fee, fee_payment_id = v_pay
  where id = o.id;
  return query select v_credit > 0, v_receipt, case when v_credit = 0 then 'Bill already paid; refund due' when round(p_amount, 2) > v_credit then 'Recorded; extra kept as refund due' else 'Recorded' end;
end $$;
revoke all on function public.complete_payment_order(text, text, numeric, text, timestamptz, text, numeric) from public, anon, authenticated;
grant execute on function public.complete_payment_order(text, text, numeric, text, timestamptz, text, numeric) to service_role;

create function public.fail_payment_order(p_public_id text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.payment_log(p_public_id, 'failed', jsonb_build_object('reason', left(p_reason, 200)));
  update public.payment_order set status = 'failed', failure_reason = left(p_reason, 200) where public_id = p_public_id and status in ('created', 'pending');
end $$;
revoke all on function public.fail_payment_order(text, text) from public, anon, authenticated;
grant execute on function public.fail_payment_order(text, text) to service_role;

-- A refund (or chargeback) the gateway confirmed: a refund receipt on the bill.
create function public.refund_payment_order(p_public_id text, p_amount numeric, p_ref text, p_kind text default 'refund')
returns table (ok boolean, message text)
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order; v_part numeric;
begin
  select * into o from public.payment_order where public_id = p_public_id for update;
  if o.id is null then return query select false, 'Unknown payment'; return; end if;
  if exists (select 1 from public.payment_event e where e.order_id = o.id and e.kind = p_kind and e.detail ->> 'ref' = p_ref) then
    return query select true, 'Already recorded'; return;
  end if;
  if round(p_amount, 2) <= 0 or o.refunded_amount + round(p_amount, 2) > coalesce(o.received_amount, 0) then
    return query select false, 'Refund is more than was received'; return;
  end if;
  insert into public.payment_event (school_id, order_id, kind, detail) values (o.school_id, o.id, p_kind, jsonb_build_object('ref', p_ref, 'amount', p_amount));
  -- first from the refund due (money never credited to the bill), then from the bill
  v_part := greatest(round(p_amount, 2) - o.refund_due, 0);
  if v_part > 0 and o.fee_payment_id is not null then
    insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode, reference, note, is_refund, is_test, fin_voucher_id)
    values (o.school_id, o.invoice_id, v_part, (now() at time zone 'Asia/Kolkata')::date, 'online', left(o.provider || ' ' || p_kind || ' ' || coalesce(p_ref, ''), 80),
            case when p_kind = 'chargeback' then 'Chargeback by the bank' else 'Refunded online' end, true, o.mode = 'test', case when o.mode = 'test' then 0 end);
  end if;
  update public.payment_order set refunded_amount = refunded_amount + round(p_amount, 2), refund_due = greatest(refund_due - round(p_amount, 2), 0) where id = o.id;
  return query select true, 'Recorded';
end $$;
revoke all on function public.refund_payment_order(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.refund_payment_order(text, numeric, text, text) to service_role;

create function public.set_payment_gateway_secret(p_gateway bigint, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id uuid;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change payment settings'; end if;
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
revoke all on function public.set_payment_gateway_secret(bigint, text) from public, anon;
grant execute on function public.set_payment_gateway_secret(bigint, text) to authenticated;
drop function if exists public.set_payment_secret(text);

-- abandoned attempts expire after 2 hours (the bank may still answer late:
-- complete_payment_order credits an expired attempt too)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'payment-orders-expire';
  perform cron.schedule('payment-orders-expire', '*/10 * * * *', $q$update public.payment_order set status = 'expired' where status = 'created' and expires_at < now() - interval '90 minutes'$q$);
end $$;
commit;
