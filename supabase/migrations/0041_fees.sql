-- =============================================================================
-- Migration 0041 — Fees
--   fee_head         : what a fee is for (Tuition, Transport, Exam ...)
--   fee_structure    : the amount per class per head for a year
--   fee_invoice      : one bill raised on a student ("Term 1 fees")
--   fee_invoice_line : the heads that make up an invoice
--   fee_payment      : money received (or refunded) against an invoice
--
-- Read access
--   * fee_head                : every signed-in user (names appear on receipts)
--   * fee_structure           : principal / office
--   * invoice, line, payment  : principal / office (everything); a student or
--                               guardian sees only their own (child's) rows.
-- Write access: the office only. The principal reads but never writes.
-- Teachers have no access to any fee table.
--
-- Only creates new objects. Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.fee_head (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_fee_head_name on public.fee_head (lower(btrim(name)));

create table if not exists public.fee_structure (
  id               bigint generated always as identity primary key,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  class_id         bigint not null references public.class(id) on delete cascade,
  fee_head_id      bigint not null references public.fee_head(id) on delete cascade,
  amount           numeric(12,2) not null default 0 check (amount >= 0),
  created_at       timestamptz not null default now(),
  unique (academic_year_id, class_id, fee_head_id)
);
create index if not exists idx_fee_structure_class on public.fee_structure(class_id);
create index if not exists idx_fee_structure_head  on public.fee_structure(fee_head_id);

create table if not exists public.fee_invoice (
  id               bigint generated always as identity primary key,
  student_id       bigint not null references public.student(id) on delete cascade,
  section_id       bigint references public.section(id) on delete set null,  -- section when raised
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 80),
  amount           numeric(12,2) not null check (amount >= 0),
  -- Payments minus refunds. Kept in step by the app after every payment so
  -- lists and totals never have to add up the payment rows again.
  paid_amount      numeric(12,2) not null default 0,
  due_date         date not null,
  status           text not null default 'due' check (status in ('due','part','paid','cancelled')),
  created_by       bigint references public.staff(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_fee_invoice_student      on public.fee_invoice(student_id);
create index if not exists idx_fee_invoice_year_status  on public.fee_invoice(academic_year_id, status);
create index if not exists idx_fee_invoice_section_year on public.fee_invoice(section_id, academic_year_id);
create index if not exists idx_fee_invoice_created_by   on public.fee_invoice(created_by);
-- A student is billed once per title per year (a cancelled bill may be raised again).
create unique index if not exists uq_fee_invoice_student_title
  on public.fee_invoice (student_id, academic_year_id, lower(btrim(title)))
  where status <> 'cancelled';

create table if not exists public.fee_invoice_line (
  id           bigint generated always as identity primary key,
  invoice_id   bigint not null references public.fee_invoice(id) on delete cascade,
  fee_head_id  bigint not null references public.fee_head(id) on delete restrict,
  amount       numeric(12,2) not null check (amount >= 0)
);
create index if not exists idx_fee_line_invoice on public.fee_invoice_line(invoice_id);
create index if not exists idx_fee_line_head    on public.fee_invoice_line(fee_head_id);

create sequence if not exists public.fee_receipt_seq;

create table if not exists public.fee_payment (
  id           bigint generated always as identity primary key,
  invoice_id   bigint not null references public.fee_invoice(id) on delete restrict,
  -- Copied from the invoice by the trigger below, so row rules need no join.
  student_id   bigint not null references public.student(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  mode         text not null check (mode in ('cash','upi','card','bank','cheque')),
  reference    text check (reference is null or char_length(reference) <= 80),
  receipt_no   text not null unique,          -- "R-2025-000123", set by the trigger
  received_by  bigint references public.staff(id) on delete set null,
  is_refund    boolean not null default false,
  note         text check (note is null or char_length(note) <= 300),
  created_at   timestamptz not null default now()
);
create index if not exists idx_fee_payment_invoice     on public.fee_payment(invoice_id);
create index if not exists idx_fee_payment_student     on public.fee_payment(student_id);
create index if not exists idx_fee_payment_paid_on     on public.fee_payment(paid_on desc, id desc);
create index if not exists idx_fee_payment_received_by on public.fee_payment(received_by);

-- ---------------------------------------------------------------------------
-- Every payment gets its student from the invoice and the next receipt number.
-- Whatever the caller sends for those two columns is overwritten, so a receipt
-- number can never be chosen or reused, and a payment can never point at a
-- different student than its invoice.
-- ---------------------------------------------------------------------------
create or replace function public.fee_payment_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select i.student_id into new.student_id from public.fee_invoice i where i.id = new.invoice_id;
  if new.student_id is null then
    raise exception 'Fee invoice % not found', new.invoice_id;
  end if;
  new.receipt_no := 'R-' || to_char(coalesce(new.paid_on, current_date), 'YYYY') || '-'
                    || lpad(nextval('public.fee_receipt_seq')::text, 6, '0');
  return new;
end $$;
revoke execute on function public.fee_payment_before_insert() from public, anon, authenticated;

drop trigger if exists trg_fee_payment_before_insert on public.fee_payment;
create trigger trg_fee_payment_before_insert before insert on public.fee_payment
  for each row execute function public.fee_payment_before_insert();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.fee_head         enable row level security;
alter table public.fee_structure    enable row level security;
alter table public.fee_invoice      enable row level security;
alter table public.fee_invoice_line enable row level security;
alter table public.fee_payment      enable row level security;

-- fee_head
drop policy if exists fee_head_read   on public.fee_head;
drop policy if exists fee_head_insert on public.fee_head;
drop policy if exists fee_head_update on public.fee_head;
drop policy if exists fee_head_delete on public.fee_head;
create policy fee_head_read on public.fee_head
  for select to authenticated using (true);
create policy fee_head_insert on public.fee_head
  for insert to authenticated with check ((select app.is_office()));
create policy fee_head_update on public.fee_head
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy fee_head_delete on public.fee_head
  for delete to authenticated using ((select app.is_office()));

-- fee_structure
drop policy if exists fee_structure_read   on public.fee_structure;
drop policy if exists fee_structure_insert on public.fee_structure;
drop policy if exists fee_structure_update on public.fee_structure;
drop policy if exists fee_structure_delete on public.fee_structure;
create policy fee_structure_read on public.fee_structure
  for select to authenticated using ((select app.is_admin_scope()));
create policy fee_structure_insert on public.fee_structure
  for insert to authenticated with check ((select app.is_office()));
create policy fee_structure_update on public.fee_structure
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy fee_structure_delete on public.fee_structure
  for delete to authenticated using ((select app.is_office()));

-- fee_invoice
drop policy if exists fee_invoice_read   on public.fee_invoice;
drop policy if exists fee_invoice_insert on public.fee_invoice;
drop policy if exists fee_invoice_update on public.fee_invoice;
drop policy if exists fee_invoice_delete on public.fee_invoice;
create policy fee_invoice_read on public.fee_invoice
  for select to authenticated using (
    (select app.is_admin_scope())
    or student_id in (select app.my_owned_students())
  );
create policy fee_invoice_insert on public.fee_invoice
  for insert to authenticated with check ((select app.is_office()));
create policy fee_invoice_update on public.fee_invoice
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy fee_invoice_delete on public.fee_invoice
  for delete to authenticated using ((select app.is_office()));

-- fee_invoice_line (visible exactly when its invoice is)
drop policy if exists fee_invoice_line_read   on public.fee_invoice_line;
drop policy if exists fee_invoice_line_insert on public.fee_invoice_line;
drop policy if exists fee_invoice_line_update on public.fee_invoice_line;
drop policy if exists fee_invoice_line_delete on public.fee_invoice_line;
create policy fee_invoice_line_read on public.fee_invoice_line
  for select to authenticated using (
    (select app.is_admin_scope())
    or exists (
      select 1 from public.fee_invoice i
      where i.id = fee_invoice_line.invoice_id
        and i.student_id in (select app.my_owned_students())
    )
  );
create policy fee_invoice_line_insert on public.fee_invoice_line
  for insert to authenticated with check ((select app.is_office()));
create policy fee_invoice_line_update on public.fee_invoice_line
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy fee_invoice_line_delete on public.fee_invoice_line
  for delete to authenticated using ((select app.is_office()));

-- fee_payment
drop policy if exists fee_payment_read   on public.fee_payment;
drop policy if exists fee_payment_insert on public.fee_payment;
drop policy if exists fee_payment_update on public.fee_payment;
drop policy if exists fee_payment_delete on public.fee_payment;
create policy fee_payment_read on public.fee_payment
  for select to authenticated using (
    (select app.is_admin_scope())
    or student_id in (select app.my_owned_students())
  );
create policy fee_payment_insert on public.fee_payment
  for insert to authenticated with check ((select app.is_office()));
create policy fee_payment_update on public.fee_payment
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy fee_payment_delete on public.fee_payment
  for delete to authenticated using ((select app.is_office()));

grant select, insert, update, delete on public.fee_head         to authenticated;
grant select, insert, update, delete on public.fee_structure    to authenticated;
grant select, insert, update, delete on public.fee_invoice      to authenticated;
grant select, insert, update, delete on public.fee_invoice_line to authenticated;
grant select, insert, update, delete on public.fee_payment      to authenticated;

-- ---------------------------------------------------------------------------
-- A starting list of fee heads. The office can rename, add or switch them off.
-- ---------------------------------------------------------------------------
insert into public.fee_head (name)
select v.name from (values ('Tuition'), ('Transport'), ('Exam')) as v(name)
where not exists (select 1 from public.fee_head);

notify pgrst, 'reload schema';
