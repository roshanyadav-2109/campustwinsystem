-- Fees, step 1: instalments, concessions, and raising a whole instalment.
--
-- * fee_head.charge: 'split' (spread over the year's instalments) or 'once'
--   (charged in full on the first instalment, like an annual or admission fee).
--   fee_head.is_tuition: counts towards the yearly tuition-fee certificate.
-- * fee_instalment: the year's schedule (Term 1, 2, 3 or monthly) with each
--   instalment's share of the year and due date. auto_raise is OFF by default.
-- * fee_concession_type / student_concession: concessions (percent or a yearly
--   amount), optionally limited to some heads; 'sibling' types are given
--   automatically to the second child onwards (by date of birth, then admission
--   number) and are stored visibly on the student so the office can remove them.
-- * fee_invoice_line gains kind (charge, concession, late_fee, transport, other),
--   label and waived; only charges need a fee head. Concessions are stored as
--   positive amounts and subtracted.
-- * fee_invoice.instalment_id: one invoice per student per instalment.
-- * public.raise_instalment(): raises an instalment for a class, a section or
--   the whole school, with every line and concession, writing each invoice's
--   final total once. Shares use cumulative rounding so a year always adds up
--   to the annual amount exactly.
-- * Totals: editing lines later recomputes that invoice (skipped during bulk
--   raising); payments recompute paid and status in the database.
-- Existing invoices are never recomputed by this migration. Idempotent.
begin;

-- ------------------------------------------------------------ heads
alter table public.fee_head add column if not exists charge text not null default 'split' check (charge in ('split', 'once'));
alter table public.fee_head add column if not exists is_tuition boolean not null default false;
update public.fee_head set is_tuition = true where is_tuition = false and lower(name) like '%tuition%';

-- ------------------------------------------------------------ instalments
create table if not exists public.fee_instalment (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  seq              smallint not null check (seq between 1 and 24),
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  due_date         date not null,
  share_pct        numeric(6,3) not null check (share_pct > 0 and share_pct <= 100),
  auto_raise       boolean not null default false,
  raise_days_before smallint not null default 15 check (raise_days_before between 0 and 120),
  raised_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (academic_year_id, seq)
);

-- ------------------------------------------------------------ concessions
create table if not exists public.fee_concession_type (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  kind       text not null check (kind in ('percent', 'amount')),
  value      numeric(12,2) not null check (value > 0),
  head_ids   bigint[],                       -- null: every head
  auto_rule  text check (auto_rule in ('sibling')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);
create unique index if not exists uq_fee_concession_type_name on public.fee_concession_type (school_id, lower(btrim(name)));

create table if not exists public.student_concession (
  id                 bigint generated always as identity primary key,
  school_id          bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id         bigint not null references public.student(id) on delete cascade,
  concession_type_id bigint not null references public.fee_concession_type(id) on delete cascade,
  academic_year_id   bigint not null references public.academic_year(id) on delete cascade,
  status             text not null default 'active' check (status in ('active', 'removed')),
  is_auto            boolean not null default false,
  note               text check (note is null or char_length(note) <= 300),
  granted_by         bigint references public.staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (student_id, concession_type_id, academic_year_id)
);

-- ------------------------------------------------------------ lines and invoices
alter table public.fee_invoice_line add column if not exists kind text not null default 'charge'
  check (kind in ('charge', 'concession', 'late_fee', 'transport', 'other'));
alter table public.fee_invoice_line add column if not exists label text check (label is null or char_length(label) <= 80);
alter table public.fee_invoice_line add column if not exists waived boolean not null default false;
alter table public.fee_invoice_line add column if not exists waive_reason text check (waive_reason is null or char_length(waive_reason) <= 300);
alter table public.fee_invoice_line add column if not exists school_id bigint references public.school(id) on delete cascade;
alter table public.fee_invoice_line alter column fee_head_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fee_line_head_for_charges') then
    alter table public.fee_invoice_line add constraint fee_line_head_for_charges check (kind <> 'charge' or fee_head_id is not null);
  end if;
end $$;

alter table public.fee_invoice add column if not exists instalment_id bigint references public.fee_instalment(id) on delete set null;
create unique index if not exists uq_fee_invoice_student_instalment
  on public.fee_invoice (student_id, instalment_id) where instalment_id is not null and status <> 'cancelled';

-- Status from total and paid (a zero total is paid).
create or replace function public.fee_status(p_amount numeric, p_paid numeric) returns text
language sql immutable as $$
  select case when round(coalesce(p_paid, 0) * 100) <= 0 then (case when round(p_amount * 100) <= 0 then 'paid' else 'due' end)
              when round(p_paid * 100) >= round(p_amount * 100) then 'paid' else 'part' end;
$$;

-- An invoice's total from its lines: charges and extras add, concessions
-- subtract, waived lines do not count; never below zero.
create or replace function public.fee_invoice_total(p_invoice bigint) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0, coalesce(sum(case when l.waived then 0 when l.kind = 'concession' then -l.amount else l.amount end), 0))
  from public.fee_invoice_line l where l.invoice_id = p_invoice;
$$;

-- Line edits after raising (a waiver, a late fee) recompute that invoice.
-- Bulk raising sets fees.bulk and writes final totals itself.
create or replace function public.fee_line_recompute() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_inv bigint := coalesce(new.invoice_id, old.invoice_id); v_total numeric;
begin
  if current_setting('fees.bulk', true) = 'on' then return null; end if;
  v_total := public.fee_invoice_total(v_inv);
  update public.fee_invoice i set amount = v_total, status = public.fee_status(v_total, i.paid_amount)
   where i.id = v_inv and i.status <> 'cancelled' and (i.amount is distinct from v_total or i.status is distinct from public.fee_status(v_total, i.paid_amount));
  return null;
end $$;
drop trigger if exists trg_fee_line_recompute on public.fee_invoice_line;
create trigger trg_fee_line_recompute after insert or update or delete on public.fee_invoice_line
  for each row execute function public.fee_line_recompute();

-- Payments keep paid and status right in the database too.
create or replace function public.fee_payment_settle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_paid numeric;
begin
  select coalesce(sum(case when p.is_refund then -p.amount else p.amount end), 0) into v_paid
    from public.fee_payment p where p.invoice_id = new.invoice_id;
  update public.fee_invoice i set paid_amount = v_paid, status = public.fee_status(i.amount, v_paid)
   where i.id = new.invoice_id and i.status <> 'cancelled' and (i.paid_amount is distinct from v_paid or i.status is distinct from public.fee_status(i.amount, v_paid));
  return null;
end $$;
drop trigger if exists trg_fee_payment_settle on public.fee_payment;
create trigger trg_fee_payment_settle after insert on public.fee_payment
  for each row execute function public.fee_payment_settle();

-- ------------------------------------------------------------ siblings
-- 1 for the eldest (by date of birth, then admission number) among the
-- student's siblings enrolled this year (children sharing a parent), 2 for the
-- next, and so on.
create or replace function public.sibling_rank(p_student bigint, p_year bigint) returns int
language sql stable security definer set search_path = '' as $$
  with fam as (
    select distinct gs2.student_id
    from public.guardian_student gs1
    join public.guardian_student gs2 on gs2.guardian_id = gs1.guardian_id
    join public.student_enrollment e on e.student_id = gs2.student_id and e.academic_year_id = p_year and e.status <> 'transferred'
    where gs1.student_id = p_student
  )
  select r from (
    select s.id, row_number() over (order by s.dob nulls last, s.admission_no, s.id) r
    from public.student s join fam on fam.student_id = s.id
  ) x where x.id = p_student;
$$;

-- ------------------------------------------------------------ raise an instalment
create or replace function public.raise_instalment(p_instalment bigint, p_class bigint default null, p_section bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ins public.fee_instalment;
  v_school bigint; v_year bigint; v_first boolean; v_cum_prev numeric; v_cum numeric;
  v_actor bigint; v_made int := 0;
  st record; h record; c record;
  v_inv bigint; v_charges numeric; v_applicable numeric; v_off numeric; v_total numeric;
begin
  select * into ins from public.fee_instalment where id = p_instalment;
  if not found then raise exception 'Instalment not found'; end if;
  v_school := ins.school_id; v_year := ins.academic_year_id;
  -- Office of this school, or the system (scheduled raising has no user).
  if auth.uid() is not null and not (app.is_office() and public.current_school_id() = v_school) then
    raise exception 'Only the school office can raise fees';
  end if;
  v_actor := case when auth.uid() is null then null else app.my_staff_id() end;
  v_first := not exists (select 1 from public.fee_instalment x where x.academic_year_id = v_year and x.seq < ins.seq);
  select coalesce(sum(share_pct), 0) into v_cum_prev from public.fee_instalment x where x.academic_year_id = v_year and x.seq < ins.seq;
  v_cum := v_cum_prev + ins.share_pct;
  perform set_config('fees.bulk', 'on', true);
  create temp table if not exists _lines (head_id bigint, amount numeric, kind text, label text) on commit drop;

  for st in
    select e.student_id, e.section_id, sec.class_id
    from public.student_enrollment e
    join public.section sec on sec.id = e.section_id
    where e.academic_year_id = v_year and e.status <> 'transferred' and sec.school_id = v_school
      and (p_class is null or sec.class_id = p_class) and (p_section is null or e.section_id = p_section)
      and not exists (select 1 from public.fee_invoice i where i.student_id = e.student_id and i.instalment_id = ins.id and i.status <> 'cancelled')
  loop
    -- charge lines: cumulative rounding keeps the year exact
    truncate pg_temp._lines;
    for h in
      select fs.fee_head_id, fs.amount, fh.charge
      from public.fee_structure fs join public.fee_head fh on fh.id = fs.fee_head_id
      where fs.academic_year_id = v_year and fs.class_id = st.class_id and fh.is_active and fs.amount > 0
    loop
      if h.charge = 'once' then
        if v_first then insert into pg_temp._lines values (h.fee_head_id, round(h.amount, 2), 'charge', null); end if;
      else
        insert into pg_temp._lines values (h.fee_head_id, round(h.amount * v_cum / 100, 2) - round(h.amount * v_cum_prev / 100, 2), 'charge', null);
      end if;
    end loop;
    delete from pg_temp._lines where amount <= 0;
    select coalesce(sum(amount), 0) into v_charges from pg_temp._lines;
    if v_charges <= 0 then continue; end if;

    -- automatic sibling concessions, stored on the student (unless removed)
    if public.sibling_rank(st.student_id, v_year) >= 2 then
      insert into public.student_concession (school_id, student_id, concession_type_id, academic_year_id, is_auto, note)
      select v_school, st.student_id, t.id, v_year, true, 'Given automatically: second child or later'
      from public.fee_concession_type t
      where t.school_id = v_school and t.active and t.auto_rule = 'sibling'
      on conflict (student_id, concession_type_id, academic_year_id) do nothing;
    end if;

    -- concessions
    for c in
      select t.name, t.kind, t.value, t.head_ids
      from public.student_concession sc join public.fee_concession_type t on t.id = sc.concession_type_id
      where sc.student_id = st.student_id and sc.academic_year_id = v_year and sc.status = 'active' and t.active
      order by t.id
    loop
      select coalesce(sum(amount), 0) into v_applicable from pg_temp._lines
       where kind = 'charge' and (c.head_ids is null or head_id = any(c.head_ids));
      v_off := case when c.kind = 'percent' then round(v_applicable * c.value / 100, 2)
                    else round(c.value * v_cum / 100, 2) - round(c.value * v_cum_prev / 100, 2) end;
      v_off := least(v_off, v_applicable);
      if v_off > 0 then insert into pg_temp._lines values (null, v_off, 'concession', c.name); end if;
    end loop;

    select greatest(0, coalesce(sum(case when kind = 'concession' then -amount else amount end), 0)) into v_total from pg_temp._lines;
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, created_by, instalment_id)
    values (v_school, st.student_id, st.section_id, v_year, ins.name, v_total, 0, ins.due_date, public.fee_status(v_total, 0), v_actor, ins.id)
    returning id into v_inv;
    insert into public.fee_invoice_line (invoice_id, fee_head_id, amount, kind, label, school_id)
    select v_inv, head_id, amount, kind, label, v_school from pg_temp._lines;
    v_made := v_made + 1;
  end loop;

  perform set_config('fees.bulk', 'off', true);
  if p_class is null and p_section is null then update public.fee_instalment set raised_at = now() where id = ins.id; end if;
  return v_made;
end $$;
revoke all on function public.raise_instalment(bigint, bigint, bigint) from public, anon;
grant execute on function public.raise_instalment(bigint, bigint, bigint) to authenticated, service_role;

-- ------------------------------------------------------------ access
alter table public.fee_instalment       enable row level security;
alter table public.fee_concession_type  enable row level security;
alter table public.student_concession   enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fee_instalment', 'fee_concession_type', 'student_concession'] loop
    execute format('drop policy if exists %1$s_tenant on public.%1$s', t);
    execute format('create policy %1$s_tenant on public.%1$s as restrictive for all to authenticated using (school_id = public.current_school_id()) with check (school_id = public.current_school_id())', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using ((select app.is_admin_scope()))', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- Families see their own concessions on their fees page.
drop policy if exists student_concession_family on public.student_concession;
create policy student_concession_family on public.student_concession for select to authenticated
  using (student_id in (select app.my_owned_students()));

-- change history for the new admin tables
do $$
declare t record;
begin
  for t in select * from (values ('fee_instalment', 'Fee instalment'), ('fee_concession_type', 'Concession type'), ('student_concession', 'Student concession')) as x(tbl, words)
  loop
    execute format('drop trigger if exists trg_log_change on public.%I', t.tbl);
    execute format('create trigger trg_log_change after insert or update or delete on public.%I for each row execute function public.log_change(%L)', t.tbl, t.words);
  end loop;
end $$;

commit;
