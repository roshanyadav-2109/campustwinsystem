-- Eternity Finance, first release: chart of accounts, customers and vendors,
-- sales invoices and purchase bills with GST, receipts and payments matched to
-- them, journal entries, an immutable general ledger, and reports.
--
-- Rules:
--   * Every document (voucher) is a draft until posted. Posting checks it,
--     gives it its number and writes balanced ledger entries. A posted voucher
--     is never edited; cancelling writes reversing entries.
--   * Ledger entries are written only by the post and cancel functions.
--   * Books can be locked up to a date; nothing on or before it can be posted
--     or cancelled.
--   * Access per organisation with a live `finance` subscription: admins (the
--     organisation's owner and admins, platform owners, and fin.team admins),
--     accountants (create and post), viewers (read only).
-- Money is numeric(15,2): exact rupees and paise. Idempotent.

begin;

create schema if not exists fin;

-- ------------------------------------------------------------ settings and access
create table if not exists fin.settings (
  org_id             uuid primary key references core.organisation(id) on delete cascade,
  legal_name         text check (legal_name is null or char_length(legal_name) <= 200),
  gstin              text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code         text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  books_locked_until date,
  receivable_account bigint, payable_account bigint, round_off_account bigint,
  output_cgst bigint, output_sgst bigint, output_igst bigint,
  input_cgst bigint, input_sgst bigint, input_igst bigint,
  updated_at         timestamptz not null default now()
);

create table if not exists fin.team (
  org_id   uuid not null references core.organisation(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null check (role in ('admin', 'accountant', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create or replace function fin.subscribed(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.subscription s
    where s.org_id = p_org and s.product_code = 'finance' and s.status in ('trial', 'active', 'past_due'))
$$;

create or replace function fin.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_owner po join auth.users u on lower(u.email) = lower(po.email) where u.id = auth.uid())
$$;

-- 'admin', 'accountant', 'viewer' or null.
create or replace function fin.role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not fin.subscribed(p_org) then null
    when fin.is_platform_owner() then 'admin'
    when exists (select 1 from core.membership m where m.org_id = p_org and m.user_id = auth.uid()
                  and m.status = 'active' and m.role in ('owner', 'admin')) then 'admin'
    else (select t.role from fin.team t where t.org_id = p_org and t.user_id = auth.uid())
  end
$$;

create or replace function fin.can_write(p_org uuid) returns boolean
language sql stable as $$ select coalesce(fin.role(p_org) in ('admin', 'accountant'), false) $$;

create or replace function fin.my_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from core.organisation o where o.status = 'active' and fin.role(o.id) is not null
$$;

-- ------------------------------------------------------------ accounts and parties
create table if not exists fin.account (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references core.organisation(id) on delete cascade,
  code         text not null check (code ~ '^[0-9A-Z][0-9A-Z.-]{0,14}$'),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  root_type    text not null check (root_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  account_type text check (account_type in ('bank', 'cash', 'receivable', 'payable', 'tax', 'fixed_asset', 'round_off')),
  parent_id    bigint,
  is_group     boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, id),
  foreign key (org_id, parent_id) references fin.account (org_id, id),
  check (parent_id is null or parent_id <> id)
);

create table if not exists fin.party (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organisation(id) on delete cascade,
  kind       text not null default 'customer' check (kind in ('customer', 'vendor', 'both')),
  name       text not null check (char_length(btrim(name)) between 1 and 160),
  gstin      text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  email      text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (phone is null or char_length(phone) <= 20),
  address    text check (address is null or char_length(address) <= 500),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

-- ------------------------------------------------------------ vouchers
create table if not exists fin.voucher (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references core.organisation(id) on delete cascade,
  kind            text not null check (kind in ('journal', 'sales_invoice', 'purchase_bill', 'receipt', 'payment')),
  number          text,
  date            date not null,
  due_date        date,
  party_id        bigint,
  cash_account_id bigint,           -- receipts and payments: the bank or cash account
  amount          numeric(15,2),    -- receipts and payments: the amount received or paid
  reference       text check (reference is null or char_length(reference) <= 80),
  narration       text check (narration is null or char_length(narration) <= 500),
  status          text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  subtotal        numeric(15,2),
  tax_total       numeric(15,2),
  total           numeric(15,2),
  interstate      boolean,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  posted_by       uuid,
  posted_at       timestamptz,
  cancelled_by    uuid,
  cancelled_at    timestamptz,
  unique (org_id, id),
  foreign key (org_id, party_id)        references fin.party (org_id, id)  ,
  foreign key (org_id, cash_account_id) references fin.account (org_id, id),
  check (amount is null or amount > 0),
  check (due_date is null or due_date >= date),
  check ((status = 'draft') = (number is null))
);
create unique index if not exists voucher_number on fin.voucher (org_id, number) where number is not null;
create index if not exists voucher_list on fin.voucher (org_id, kind, date desc);
create index if not exists voucher_party on fin.voucher (party_id) where party_id is not null;

-- Invoice and bill lines.
create table if not exists fin.voucher_item (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  voucher_id  bigint not null,
  line_no     smallint not null check (line_no between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  account_id  bigint not null,
  qty         numeric(12,3) not null default 1 check (qty > 0),
  rate        numeric(15,2) not null check (rate >= 0),
  tax_rate    numeric(5,2) not null default 0 check (tax_rate in (0, 0.25, 3, 5, 12, 18, 28)),
  amount      numeric(15,2) generated always as (round(qty * rate, 2)) stored,
  foreign key (org_id, voucher_id) references fin.voucher (org_id, id) on delete cascade,
  foreign key (org_id, account_id) references fin.account (org_id, id),
  unique (voucher_id, line_no)
);

-- Journal entry lines.
create table if not exists fin.journal_line (
  id         bigint generated always as identity primary key,
  org_id     uuid not null,
  voucher_id bigint not null,
  line_no    smallint not null check (line_no between 1 and 200),
  account_id bigint not null,
  party_id   bigint,
  debit      numeric(15,2) not null default 0 check (debit >= 0),
  credit     numeric(15,2) not null default 0 check (credit >= 0),
  memo       text check (memo is null or char_length(memo) <= 200),
  foreign key (org_id, voucher_id) references fin.voucher (org_id, id) on delete cascade,
  foreign key (org_id, account_id) references fin.account (org_id, id),
  foreign key (org_id, party_id)   references fin.party (org_id, id)  ,
  check ((debit > 0) <> (credit > 0)),
  unique (voucher_id, line_no)
);

-- Which invoices or bills a receipt or payment settles.
create table if not exists fin.allocation (
  id         bigint generated always as identity primary key,
  org_id     uuid not null,
  voucher_id bigint not null,   -- the receipt or payment
  against_id bigint not null,   -- the invoice or bill
  amount     numeric(15,2) not null check (amount > 0),
  foreign key (org_id, voucher_id) references fin.voucher (org_id, id) on delete cascade,
  foreign key (org_id, against_id) references fin.voucher (org_id, id),
  unique (voucher_id, against_id)
);
create index if not exists allocation_against on fin.allocation (against_id);

-- The general ledger: one row per debit or credit, written only on post or cancel.
create table if not exists fin.gl_entry (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  voucher_id  bigint not null,
  date        date not null,
  account_id  bigint not null,
  party_id    bigint,
  debit       numeric(15,2) not null default 0 check (debit >= 0),
  credit      numeric(15,2) not null default 0 check (credit >= 0),
  is_reversal boolean not null default false,
  narration   text,
  created_at  timestamptz not null default now(),
  foreign key (org_id, voucher_id) references fin.voucher (org_id, id) on delete cascade,
  foreign key (org_id, account_id) references fin.account (org_id, id),
  foreign key (org_id, party_id)   references fin.party (org_id, id)  ,
  check ((debit > 0) <> (credit > 0))
);
create index if not exists gl_account_date on fin.gl_entry (org_id, account_id, date);
create index if not exists gl_party on fin.gl_entry (party_id) where party_id is not null;
create index if not exists gl_voucher on fin.gl_entry (voucher_id);

-- Numbering: one counter per organisation, prefix and financial year.
create table if not exists fin.series (
  org_id  uuid not null references core.organisation(id) on delete cascade,
  prefix  text not null,
  fy      text not null,
  current integer not null,
  primary key (org_id, prefix, fy)
);

-- ------------------------------------------------------------ protections
-- Ledger rows are never edited; they only disappear with their organisation
-- (a cascade, one trigger level deeper).
create or replace function fin.gl_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Ledger entries cannot be changed; cancel the voucher instead';
end $$;
drop trigger if exists gl_append_only on fin.gl_entry;
create trigger gl_append_only before update or delete on fin.gl_entry
  for each row execute function fin.gl_append_only();

-- A posted or cancelled voucher and its lines are frozen. The post and cancel
-- functions set fin.internal so they alone may change the header.
create or replace function fin.voucher_frozen() returns trigger language plpgsql as $$
begin
  if current_setting('fin.internal', true) = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if old.status <> 'draft' then
    raise exception 'A posted voucher cannot be changed; cancel it instead';
  end if;
  if tg_op = 'UPDATE' and (new.status <> 'draft' or new.number is not null or new.org_id <> old.org_id or new.kind <> old.kind) then
    raise exception 'Use Post or Cancel to change a voucher''s status';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists voucher_frozen on fin.voucher;
create trigger voucher_frozen before update or delete on fin.voucher
  for each row execute function fin.voucher_frozen();

create or replace function fin.voucher_insert_check() returns trigger language plpgsql as $$
begin
  if current_setting('fin.internal', true) = '1' then return new; end if;
  if new.status <> 'draft' or new.number is not null then
    raise exception 'New vouchers start as drafts';
  end if;
  new.posted_by := null; new.posted_at := null; new.cancelled_by := null; new.cancelled_at := null;
  new.subtotal := null; new.tax_total := null; new.total := null; new.interstate := null;
  return new;
end $$;
drop trigger if exists voucher_insert_check on fin.voucher;
create trigger voucher_insert_check before insert on fin.voucher
  for each row execute function fin.voucher_insert_check();

-- Lines belong to a draft voucher of the same organisation.
create or replace function fin.line_frozen() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_id bigint;
begin
  if current_setting('fin.internal', true) = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  v_id := case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  select status into v_status from fin.voucher where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'Lines of a posted voucher cannot be changed';
  end if;
  if tg_op = 'UPDATE' and old.voucher_id <> new.voucher_id then
    raise exception 'A line cannot move to another voucher';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists voucher_item_frozen on fin.voucher_item;
create trigger voucher_item_frozen before insert or update or delete on fin.voucher_item
  for each row execute function fin.line_frozen();
drop trigger if exists journal_line_frozen on fin.journal_line;
create trigger journal_line_frozen before insert or update or delete on fin.journal_line
  for each row execute function fin.line_frozen();
drop trigger if exists allocation_frozen on fin.allocation;
create trigger allocation_frozen before insert or update or delete on fin.allocation
  for each row execute function fin.line_frozen();

-- ------------------------------------------------------------ helpers
-- Indian financial year of a date: 2026-27 for 1 Apr 2026 to 31 Mar 2027.
create or replace function fin.fy(d date) returns text language sql immutable as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end
$$;

-- Still unpaid on a posted invoice or bill.
create or replace function fin.outstanding(p_voucher bigint) returns numeric
language sql stable security definer set search_path = '' as $$
  select v.total - coalesce((select sum(a.amount) from fin.allocation a join fin.voucher p on p.id = a.voucher_id
                             where a.against_id = v.id and p.status = 'posted'), 0)
  from fin.voucher v where v.id = p_voucher and v.status = 'posted'
$$;

create or replace function fin.postable(p_org uuid, p_account bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from fin.account a where a.id = p_account and a.org_id = p_org and not a.is_group and a.active)
$$;

-- ------------------------------------------------------------ post
create or replace function fin.post_voucher(p_voucher bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v fin.voucher;
  s fin.settings;
  pty fin.party;
  r record;
  v_sub numeric(15,2) := 0; v_tax numeric(15,2) := 0; v_total numeric(15,2);
  v_inter boolean := false;
  v_half numeric(15,2);
  v_dr numeric(15,2); v_cr numeric(15,2);
  v_alloc numeric(15,2);
  v_prefix text; v_n integer; v_number text;
begin
  select * into v from fin.voucher where id = p_voucher for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not fin.can_write(v.org_id) then raise exception 'You cannot post in these books'; end if;
  if v.status <> 'draft' then raise exception 'This voucher is already %', v.status; end if;
  select * into s from fin.settings where org_id = v.org_id;
  if not found then raise exception 'Set up the books first'; end if;
  if s.books_locked_until is not null and v.date <= s.books_locked_until then
    raise exception 'The books are locked up to %', to_char(s.books_locked_until, 'DD Mon YYYY');
  end if;
  perform set_config('fin.internal', '1', true);

  if v.kind in ('sales_invoice', 'purchase_bill') then
    if v.party_id is null then raise exception 'Choose the %', case when v.kind = 'sales_invoice' then 'customer' else 'vendor' end; end if;
    select * into pty from fin.party where id = v.party_id;
    v_inter := s.state_code is not null and pty.state_code is not null and s.state_code <> pty.state_code;
    if not exists (select 1 from fin.voucher_item where voucher_id = v.id) then raise exception 'Add at least one line'; end if;
    for r in select * from fin.voucher_item where voucher_id = v.id order by line_no loop
      if not fin.postable(v.org_id, r.account_id) then raise exception 'Line %: choose an account that can be posted to', r.line_no; end if;
      v_sub := v_sub + r.amount;
      v_tax := v_tax + round(r.amount * r.tax_rate / 100, 2);
    end loop;
    v_total := v_sub + v_tax;
    if v_total <= 0 then raise exception 'The total must be more than zero'; end if;
    if (case when v.kind = 'sales_invoice' then s.receivable_account else s.payable_account end) is null then
      raise exception 'Choose the default receivable and payable accounts in settings';
    end if;

    -- party side
    insert into fin.gl_entry (org_id, voucher_id, date, account_id, party_id, debit, credit, narration)
    values (v.org_id, v.id, v.date,
            case when v.kind = 'sales_invoice' then s.receivable_account else s.payable_account end, v.party_id,
            case when v.kind = 'sales_invoice' then v_total else 0 end,
            case when v.kind = 'sales_invoice' then 0 else v_total end, v.narration);
    -- income or expense per account
    for r in select account_id, sum(amount) amt from fin.voucher_item where voucher_id = v.id group by account_id loop
      if r.amt > 0 then
        insert into fin.gl_entry (org_id, voucher_id, date, account_id, debit, credit, narration)
        values (v.org_id, v.id, v.date, r.account_id,
                case when v.kind = 'sales_invoice' then 0 else r.amt end,
                case when v.kind = 'sales_invoice' then r.amt else 0 end, v.narration);
      end if;
    end loop;
    -- tax
    if v_tax > 0 then
      if v_inter then
        if (case when v.kind = 'sales_invoice' then s.output_igst else s.input_igst end) is null then raise exception 'Choose the IGST accounts in settings'; end if;
        insert into fin.gl_entry (org_id, voucher_id, date, account_id, debit, credit, narration)
        values (v.org_id, v.id, v.date, case when v.kind = 'sales_invoice' then s.output_igst else s.input_igst end,
                case when v.kind = 'sales_invoice' then 0 else v_tax end, case when v.kind = 'sales_invoice' then v_tax else 0 end, 'IGST');
      else
        if (case when v.kind = 'sales_invoice' then s.output_cgst else s.input_cgst end) is null then raise exception 'Choose the CGST and SGST accounts in settings'; end if;
        v_half := round(v_tax / 2, 2);
        insert into fin.gl_entry (org_id, voucher_id, date, account_id, debit, credit, narration) values
          (v.org_id, v.id, v.date, case when v.kind = 'sales_invoice' then s.output_cgst else s.input_cgst end,
           case when v.kind = 'sales_invoice' then 0 else v_half end, case when v.kind = 'sales_invoice' then v_half else 0 end, 'CGST'),
          (v.org_id, v.id, v.date, case when v.kind = 'sales_invoice' then s.output_sgst else s.input_sgst end,
           case when v.kind = 'sales_invoice' then 0 else v_tax - v_half end, case when v.kind = 'sales_invoice' then v_tax - v_half else 0 end, 'SGST');
      end if;
    end if;

  elsif v.kind in ('receipt', 'payment') then
    if v.party_id is null then raise exception 'Choose who the money is %', case when v.kind = 'receipt' then 'from' else 'for' end; end if;
    if v.amount is null then raise exception 'Enter the amount'; end if;
    if v.cash_account_id is null or not exists (select 1 from fin.account a where a.id = v.cash_account_id and a.account_type in ('bank', 'cash') and a.active) then
      raise exception 'Choose the bank or cash account';
    end if;
    v_total := v.amount;
    -- lock the matched invoices or bills so two payments posted at the same
    -- moment cannot both settle the same amount
    perform 1 from fin.voucher where id in (select against_id from fin.allocation where voucher_id = v.id) order by id for update;
    -- allocations must point at posted invoices (receipts) or bills (payments) of the same party, within what is still due
    for r in select a.amount, a.against_id, t.kind, t.party_id, t.status, fin.outstanding(t.id) due
             from fin.allocation a join fin.voucher t on t.id = a.against_id where a.voucher_id = v.id loop
      if r.status <> 'posted' or r.party_id <> v.party_id
         or r.kind <> (case when v.kind = 'receipt' then 'sales_invoice' else 'purchase_bill' end) then
        raise exception 'A matched document is not an open % of this party', case when v.kind = 'receipt' then 'invoice' else 'bill' end;
      end if;
      if r.amount > r.due then raise exception 'Matched % is more than the % still due', r.amount, r.due; end if;
    end loop;
    select coalesce(sum(amount), 0) into v_alloc from fin.allocation where voucher_id = v.id;
    if v_alloc > v.amount then raise exception 'Matched amounts add up to more than the % received', v.amount; end if;
    if (case when v.kind = 'receipt' then s.receivable_account else s.payable_account end) is null then
      raise exception 'Choose the default receivable and payable accounts in settings';
    end if;
    insert into fin.gl_entry (org_id, voucher_id, date, account_id, party_id, debit, credit, narration) values
      (v.org_id, v.id, v.date, v.cash_account_id, null,
       case when v.kind = 'receipt' then v.amount else 0 end, case when v.kind = 'receipt' then 0 else v.amount end, v.narration),
      (v.org_id, v.id, v.date, case when v.kind = 'receipt' then s.receivable_account else s.payable_account end, v.party_id,
       case when v.kind = 'receipt' then 0 else v.amount end, case when v.kind = 'receipt' then v.amount else 0 end, v.narration);

  else -- journal
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from fin.journal_line where voucher_id = v.id;
    if v_dr = 0 then raise exception 'Add the debit and credit lines'; end if;
    if v_dr <> v_cr then raise exception 'Debits (%) and credits (%) must be equal', v_dr, v_cr; end if;
    for r in select * from fin.journal_line where voucher_id = v.id order by line_no loop
      if not fin.postable(v.org_id, r.account_id) then raise exception 'Line %: choose an account that can be posted to', r.line_no; end if;
      insert into fin.gl_entry (org_id, voucher_id, date, account_id, party_id, debit, credit, narration)
      values (v.org_id, v.id, v.date, r.account_id, r.party_id, r.debit, r.credit, coalesce(r.memo, v.narration));
    end loop;
    v_total := v_dr;
  end if;

  -- every voucher must balance
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from fin.gl_entry where voucher_id = v.id;
  if v_dr <> v_cr or v_dr = 0 then raise exception 'Internal check failed: entries do not balance (% / %)', v_dr, v_cr; end if;

  v_prefix := case v.kind when 'sales_invoice' then 'INV' when 'purchase_bill' then 'BILL'
                          when 'receipt' then 'RCT' when 'payment' then 'PAY' else 'JV' end;
  insert into fin.series as sr (org_id, prefix, fy, current) values (v.org_id, v_prefix, fin.fy(v.date), 1)
  on conflict (org_id, prefix, fy) do update set current = sr.current + 1
  returning current into v_n;
  v_number := v_prefix || '/' || fin.fy(v.date) || '/' || lpad(v_n::text, 4, '0');

  update fin.voucher set status = 'posted', number = v_number, posted_by = auth.uid(), posted_at = now(),
         subtotal = case when kind in ('sales_invoice', 'purchase_bill') then v_sub end,
         tax_total = case when kind in ('sales_invoice', 'purchase_bill') then v_tax end,
         total = v_total, interstate = case when kind in ('sales_invoice', 'purchase_bill') then v_inter end
   where id = v.id;
  perform set_config('fin.internal', '', true);
  return v_number;
end $$;

-- ------------------------------------------------------------ cancel
create or replace function fin.cancel_voucher(p_voucher bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v fin.voucher; s fin.settings;
begin
  select * into v from fin.voucher where id = p_voucher for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not fin.can_write(v.org_id) then raise exception 'You cannot cancel in these books'; end if;
  if v.status = 'draft' then raise exception 'Delete a draft instead of cancelling it'; end if;
  if v.status = 'cancelled' then raise exception 'Already cancelled'; end if;
  select * into s from fin.settings where org_id = v.org_id;
  if s.books_locked_until is not null and v.date <= s.books_locked_until then
    raise exception 'The books are locked up to %', to_char(s.books_locked_until, 'DD Mon YYYY');
  end if;
  if exists (select 1 from fin.allocation a join fin.voucher p on p.id = a.voucher_id where a.against_id = v.id and p.status = 'posted') then
    raise exception 'Payments are matched against this; cancel those first';
  end if;
  perform set_config('fin.internal', '1', true);
  insert into fin.gl_entry (org_id, voucher_id, date, account_id, party_id, debit, credit, is_reversal, narration)
  select org_id, voucher_id, date, account_id, party_id, credit, debit, true, 'Cancelled'
  from fin.gl_entry where voucher_id = v.id and not is_reversal;
  update fin.voucher set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = v.id;
  perform set_config('fin.internal', '', true);
end $$;

-- ------------------------------------------------------------ setup
-- Default Indian chart of accounts and settings. Safe to run again.
create or replace function fin.setup(p_org uuid, p_state text default null, p_gstin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if fin.role(p_org) is distinct from 'admin' then raise exception 'Only finance admins can set up the books'; end if;
  for a in select * from (values
    ('1000','Assets','asset',null,null,true), ('1100','Current assets','asset',null,'1000',true),
    ('1110','Cash in hand','asset','cash','1100',false), ('1120','Bank accounts','asset',null,'1100',true),
    ('1121','Main bank account','asset','bank','1120',false), ('1130','Accounts receivable','asset','receivable','1100',false),
    ('1140','Input CGST','asset','tax','1100',false), ('1141','Input SGST','asset','tax','1100',false), ('1142','Input IGST','asset','tax','1100',false),
    ('1150','Advances and deposits','asset',null,'1100',false), ('1200','Fixed assets','asset',null,'1000',true),
    ('1210','Buildings','asset','fixed_asset','1200',false), ('1220','Furniture and fixtures','asset','fixed_asset','1200',false),
    ('1230','Computers and equipment','asset','fixed_asset','1200',false), ('1240','Vehicles','asset','fixed_asset','1200',false),
    ('2000','Liabilities','liability',null,null,true), ('2100','Accounts payable','liability','payable','2000',false),
    ('2110','Output CGST','liability','tax','2000',false), ('2111','Output SGST','liability','tax','2000',false), ('2112','Output IGST','liability','tax','2000',false),
    ('2120','TDS payable','liability','tax','2000',false), ('2130','Salaries payable','liability',null,'2000',false),
    ('2140','PF and ESI payable','liability',null,'2000',false), ('2150','Fees received in advance','liability',null,'2000',false),
    ('3000','Equity','equity',null,null,true), ('3100','Capital and corpus fund','equity',null,'3000',false), ('3200','Retained surplus','equity',null,'3000',false),
    ('4000','Income','income',null,null,true), ('4100','Fee income','income',null,'4000',false), ('4110','Transport income','income',null,'4000',false),
    ('4120','Hostel income','income',null,'4000',false), ('4200','Sales and services','income',null,'4000',false),
    ('4300','Donations and grants','income',null,'4000',false), ('4400','Interest income','income',null,'4000',false), ('4900','Other income','income',null,'4000',false),
    ('5000','Expenses','expense',null,null,true), ('5100','Salaries and wages','expense',null,'5000',false),
    ('5110','PF and ESI contribution','expense',null,'5000',false), ('5200','Rent','expense',null,'5000',false),
    ('5210','Electricity and water','expense',null,'5000',false), ('5220','Repairs and maintenance','expense',null,'5000',false),
    ('5230','Transport and fuel','expense',null,'5000',false), ('5240','Printing and stationery','expense',null,'5000',false),
    ('5250','Teaching and lab materials','expense',null,'5000',false), ('5260','Professional fees','expense',null,'5000',false),
    ('5270','Bank charges','expense',null,'5000',false), ('5280','Travel','expense',null,'5000',false),
    ('5290','Office and general','expense',null,'5000',false), ('5300','Depreciation','expense',null,'5000',false),
    ('5900','Round off','expense','round_off','5000',false)
  ) as t(code, name, root_type, account_type, parent, is_group) loop
    insert into fin.account (org_id, code, name, root_type, account_type, is_group, parent_id)
    values (p_org, a.code, a.name, a.root_type, a.account_type, a.is_group,
            (select x.id from fin.account x where x.org_id = p_org and x.code = a.parent))
    on conflict (org_id, code) do nothing;
  end loop;
  insert into fin.settings (org_id, state_code, gstin) values (p_org, p_state, p_gstin)
  on conflict (org_id) do update set state_code = coalesce(excluded.state_code, fin.settings.state_code),
                                     gstin = coalesce(excluded.gstin, fin.settings.gstin);
  update fin.settings st set
    receivable_account = coalesce(st.receivable_account, (select id from fin.account where org_id = p_org and code = '1130')),
    payable_account    = coalesce(st.payable_account,    (select id from fin.account where org_id = p_org and code = '2100')),
    round_off_account  = coalesce(st.round_off_account,  (select id from fin.account where org_id = p_org and code = '5900')),
    input_cgst  = coalesce(st.input_cgst,  (select id from fin.account where org_id = p_org and code = '1140')),
    input_sgst  = coalesce(st.input_sgst,  (select id from fin.account where org_id = p_org and code = '1141')),
    input_igst  = coalesce(st.input_igst,  (select id from fin.account where org_id = p_org and code = '1142')),
    output_cgst = coalesce(st.output_cgst, (select id from fin.account where org_id = p_org and code = '2110')),
    output_sgst = coalesce(st.output_sgst, (select id from fin.account where org_id = p_org and code = '2111')),
    output_igst = coalesce(st.output_igst, (select id from fin.account where org_id = p_org and code = '2112')),
    updated_at = now()
  where st.org_id = p_org;
end $$;

-- ------------------------------------------------------------ reports
-- Opening, period movement and closing per posting account. Income and expense
-- accounts start each financial year from zero (their result sits in equity).
create or replace function fin.trial_balance(p_org uuid, p_from date, p_to date)
returns table (account_id bigint, code text, name text, root_type text, account_type text,
               opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security definer set search_path = '' as $$
  with ok as (select fin.role(p_org) is not null as allowed),
  fy_start as (select make_date(case when extract(month from p_from) >= 4 then extract(year from p_from)::int else extract(year from p_from)::int - 1 end, 4, 1) d)
  select a.id, a.code, a.name, a.root_type, a.account_type,
    coalesce(sum(g.debit - g.credit) filter (where g.date < p_from
        and (a.root_type in ('asset', 'liability', 'equity') or g.date >= (select d from fy_start))), 0),
    coalesce(sum(g.debit) filter (where g.date between p_from and p_to), 0),
    coalesce(sum(g.credit) filter (where g.date between p_from and p_to), 0),
    coalesce(sum(g.debit - g.credit) filter (where g.date <= p_to
        and (a.root_type in ('asset', 'liability', 'equity') or g.date >= (select d from fy_start))), 0)
  from fin.account a
  left join fin.gl_entry g on g.account_id = a.id and g.org_id = p_org
  where a.org_id = p_org and not a.is_group and (select allowed from ok)
  group by a.id
  order by a.code
$$;

-- Profit or loss carried into equity: all income and expense before the
-- financial year that contains p_date.
create or replace function fin.retained_until(p_org uuid, p_date date)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when fin.role(p_org) is null then 0 else coalesce(sum(g.credit - g.debit), 0) end
  from fin.gl_entry g join fin.account a on a.id = g.account_id
  where g.org_id = p_org and a.root_type in ('income', 'expense')
    and g.date < make_date(case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end, 4, 1)
$$;

-- GST on posted invoices and bills in a period, by rate.
create or replace function fin.gst_summary(p_org uuid, p_from date, p_to date)
returns table (side text, tax_rate numeric, taxable numeric, cgst numeric, sgst numeric, igst numeric)
language sql stable security definer set search_path = '' as $$
  select case when v.kind = 'sales_invoice' then 'output' else 'input' end, i.tax_rate, sum(i.amount),
    sum(case when not v.interstate then round(round(i.amount * i.tax_rate / 100, 2) / 2, 2) else 0 end),
    sum(case when not v.interstate then round(i.amount * i.tax_rate / 100, 2) - round(round(i.amount * i.tax_rate / 100, 2) / 2, 2) else 0 end),
    sum(case when v.interstate then round(i.amount * i.tax_rate / 100, 2) else 0 end)
  from fin.voucher v join fin.voucher_item i on i.voucher_id = v.id
  where v.org_id = p_org and v.status = 'posted' and v.kind in ('sales_invoice', 'purchase_bill')
    and v.date between p_from and p_to and fin.role(p_org) is not null
  group by 1, 2 order by 1 desc, 2
$$;

-- ------------------------------------------------------------ row security
alter table fin.settings     enable row level security;
alter table fin.team         enable row level security;
alter table fin.account      enable row level security;
alter table fin.party        enable row level security;
alter table fin.voucher      enable row level security;
alter table fin.voucher_item enable row level security;
alter table fin.journal_line enable row level security;
alter table fin.allocation   enable row level security;
alter table fin.gl_entry     enable row level security;
alter table fin.series       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings', 'account', 'party', 'voucher', 'voucher_item', 'journal_line', 'allocation', 'gl_entry'] loop
    execute format('drop policy if exists %1$s_read on fin.%1$s', t);
    execute format('create policy %1$s_read on fin.%1$s for select to authenticated using (fin.role(org_id) is not null)', t);
  end loop;
  -- accountants keep accounts, parties and draft documents; posting and cancelling go through functions
  foreach t in array array['account', 'party', 'voucher', 'voucher_item', 'journal_line', 'allocation'] loop
    execute format('drop policy if exists %1$s_write on fin.%1$s', t);
    execute format('create policy %1$s_write on fin.%1$s for all to authenticated using (fin.can_write(org_id)) with check (fin.can_write(org_id))', t);
  end loop;
end $$;

drop policy if exists settings_write on fin.settings;
create policy settings_write on fin.settings for update to authenticated
  using (fin.role(org_id) = 'admin') with check (fin.role(org_id) = 'admin');
drop policy if exists team_read on fin.team;
create policy team_read on fin.team for select to authenticated using (fin.role(org_id) = 'admin');
drop policy if exists team_write on fin.team;
create policy team_write on fin.team for all to authenticated
  using (fin.role(org_id) = 'admin') with check (fin.role(org_id) = 'admin');

-- ------------------------------------------------------------ grants
revoke all on schema fin from public, anon;
revoke all on all tables    in schema fin from public, anon;
revoke all on all sequences in schema fin from public, anon;
revoke all on all functions in schema fin from public, anon;
alter default privileges in schema fin revoke all on tables    from public, anon;
alter default privileges in schema fin revoke all on sequences from public, anon;
alter default privileges in schema fin revoke all on functions from public, anon;

grant usage on schema fin to authenticated, service_role;
grant select, insert, update, delete on all tables in schema fin to authenticated, service_role;
grant usage, select on all sequences in schema fin to authenticated, service_role;
revoke insert, update, delete on fin.gl_entry from authenticated;
revoke insert, update, delete on fin.series from authenticated;
revoke insert, delete on fin.settings from authenticated;
grant execute on function
  fin.subscribed(uuid), fin.is_platform_owner(), fin.role(uuid), fin.can_write(uuid), fin.my_orgs(),
  fin.fy(date), fin.outstanding(bigint), fin.postable(uuid, bigint),
  fin.post_voucher(bigint), fin.cancel_voucher(bigint), fin.setup(uuid, text, text),
  fin.trial_balance(uuid, date, date), fin.retained_until(uuid, date), fin.gst_summary(uuid, date, date)
  to authenticated, service_role;

-- Links into reference rows (accounts, parties, leave types, requests) are
-- checked when the change is saved (DEFERRABLE INITIALLY DEFERRED): deleting a
-- row that is still in use is still refused, but removing a whole organisation
-- cascades cleanly whatever order Postgres deletes the rows in.
do $fix$
declare c record;
begin
  for c in select conrelid::regclass as t, conname, pg_get_constraintdef(oid) as def
           from pg_constraint where connamespace = 'fin'::regnamespace and contype = 'f' and confdeltype = 'r' loop
    execute format('alter table %s drop constraint %I, add constraint %I %s', c.t, c.conname, c.conname, replace(c.def, ' ON DELETE RESTRICT', ''));
  end loop;
  for c in select conrelid::regclass as t, conname
           from pg_constraint where connamespace = 'fin'::regnamespace and contype = 'f' and confdeltype = 'a' and not condeferrable loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', c.t, c.conname);
  end loop;
end $fix$;

commit;
