-- Fees, step 2: late fees, transport fees, and posting collections to Finance.
--
-- Late fees (off until a school switches them on):
--   fee_late_rule: one per school - grace days, a fixed amount once, or an
--   amount for every week or month overdue, an optional cap, and from which
--   due date it applies (by default only bills due after it was switched on).
--   apply_late_fees() keeps one "Late fee" line per overdue open invoice at the
--   right amount; waived lines are left alone. It runs nightly and right after
--   the office saves the rule. late_fee_preview() shows what a rule would add.
--   Nightly runs write one summary line to the school's activity log, not one
--   per invoice (audit.quiet).
-- Transport fees: route.annual_fee. When an instalment is raised, a student
--   with an active route this year gets a "Transport" line, split by the same
--   shares as the other fees. Concessions apply to fee heads, not transport.
-- Finance: each payment (and refund) is posted once to the school's books in
--   Eternity Finance, if the school's organisation uses Finance and its books
--   are set up: one journal per school per day per payment date -
--   Dr Cash in hand / Main bank account, Cr Fee income / Transport income.
--   fee_payment.fin_voucher_id marks what has been posted. Runs nightly.
-- Idempotent.
begin;

-- ------------------------------------------------------------ quiet audit
create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_fields text[] := '{}';
  v_actor uuid := auth.uid();
  v_name text;
  v_school bigint;
begin
  if current_setting('audit.quiet', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_fields
      from jsonb_object_keys(n) k
     where k not in ('updated_at', 'created_at') and (n -> k) is distinct from (o -> k);
    if cardinality(v_fields) = 0 then return null; end if;
  end if;
  v_school := case when tg_table_name = 'school' then (r ->> 'id')::bigint else (r ->> 'school_id')::bigint end;
  if v_school is null then return null; end if;
  if v_actor is not null then select p.full_name into v_name from public.profile p where p.id = v_actor; end if;
  insert into public.audit_log (school_id, actor_id, actor_name, action, entity, entity_id, label, fields)
  values (v_school, v_actor, coalesce(v_name, case when v_actor is null then 'Eternity or system' else 'Unknown user' end),
          case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
          tg_argv[0], r ->> 'id',
          left(coalesce(r ->> 'full_name', r ->> 'title', r ->> 'child_name', r ->> 'name', r ->> 'receipt_no',
                        r ->> 'accession_no', r ->> 'code', r ->> 'label', r ->> 'month'), 160),
          v_fields);
  return null;
end $$;

-- ------------------------------------------------------------ late fees
create table if not exists public.fee_late_rule (
  school_id     bigint primary key default public.current_school_id() references public.school(id) on delete cascade,
  enabled       boolean not null default false,
  grace_days    smallint not null default 0 check (grace_days between 0 and 90),
  kind          text not null default 'per_week' check (kind in ('once', 'per_week', 'per_month')),
  amount        numeric(12,2) not null default 0 check (amount >= 0),
  max_amount    numeric(12,2) check (max_amount is null or max_amount > 0),
  applies_from  date,                          -- bills due on or after this date; null = all bills
  updated_at    timestamptz not null default now()
);

create or replace function public.late_fee_for(p_due date, p_today date, p_grace int, p_kind text, p_amount numeric, p_max numeric)
returns numeric language sql immutable as $$
  select case when p_today - p_due <= p_grace or p_amount <= 0 then 0
    else least(coalesce(p_max, 1e12),
      case p_kind when 'once' then p_amount
                  when 'per_week' then p_amount * ceil((p_today - p_due - p_grace) / 7.0)
                  else p_amount * ceil((p_today - p_due - p_grace) / 30.0) end)
  end;
$$;

-- What a rule would add right now: invoices affected and the extra amount.
create or replace function public.late_fee_preview(p_grace int, p_kind text, p_amount numeric, p_max numeric, p_from date)
returns table (invoices int, extra numeric) language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  calc as (
    select public.late_fee_for(i.due_date, (select d from today), p_grace, p_kind, p_amount, p_max) want,
           coalesce((select sum(l.amount) from public.fee_invoice_line l where l.invoice_id = i.id and l.kind = 'late_fee' and not l.waived), 0) have,
           exists (select 1 from public.fee_invoice_line l where l.invoice_id = i.id and l.kind = 'late_fee' and l.waived) waived
    from public.fee_invoice i
    where i.school_id = public.current_school_id() and i.status in ('due', 'part')
      and (p_from is null or i.due_date >= p_from)
  )
  select count(*) filter (where want > have and not waived)::int, coalesce(sum(want - have) filter (where want > have and not waived), 0)
  from calc where (select app.is_admin_scope());
$$;
revoke all on function public.late_fee_preview(int, text, numeric, numeric, date) from public, anon;
grant execute on function public.late_fee_preview(int, text, numeric, numeric, date) to authenticated;

-- Brings late fee lines up to date for one school (or every school with a
-- rule switched on, when p_school is null and there is no signed-in user).
create or replace function public.apply_late_fees(p_school bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ru public.fee_late_rule; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  inv record; v_want numeric; v_line record; v_changed int := 0; v_total int := 0; v_sum numeric;
begin
  if auth.uid() is not null and not (app.is_office() and p_school = public.current_school_id()) then
    raise exception 'Only the school office can apply late fees';
  end if;
  perform set_config('audit.quiet', 'on', true);
  for ru in select * from public.fee_late_rule r where r.enabled and (p_school is null or r.school_id = p_school) loop
    v_changed := 0; v_sum := 0;
    for inv in
      select i.id, i.due_date from public.fee_invoice i
      where i.school_id = ru.school_id and i.status in ('due', 'part')
        and (ru.applies_from is null or i.due_date >= ru.applies_from)
        and v_today - i.due_date > ru.grace_days
    loop
      v_want := public.late_fee_for(inv.due_date, v_today, ru.grace_days, ru.kind, ru.amount, ru.max_amount);
      select id, amount, waived into v_line from public.fee_invoice_line where invoice_id = inv.id and kind = 'late_fee' order by id limit 1;
      if v_line.id is null then
        if v_want > 0 then
          insert into public.fee_invoice_line (invoice_id, amount, kind, label, school_id) values (inv.id, v_want, 'late_fee', 'Late fee', ru.school_id);
          v_changed := v_changed + 1; v_sum := v_sum + v_want;
        end if;
      elsif not v_line.waived and v_line.amount <> v_want and v_want > 0 then
        update public.fee_invoice_line set amount = v_want where id = v_line.id;
        v_changed := v_changed + 1; v_sum := v_sum + (v_want - v_line.amount);
      end if;
      v_line := null;
    end loop;
    if v_changed > 0 then
      insert into public.audit_log (school_id, actor_id, actor_name, action, entity, label, fields)
      values (ru.school_id, auth.uid(), coalesce((select full_name from public.profile where id = auth.uid()), 'Eternity or system'),
              'changed', 'Late fees', format('%s invoices, %s added', v_changed, to_char(v_sum, 'FM99,99,99,990.00')), '{}');
    end if;
    v_total := v_total + v_changed;
  end loop;
  perform set_config('audit.quiet', 'off', true);
  return v_total;
end $$;
revoke all on function public.apply_late_fees(bigint) from public, anon;
grant execute on function public.apply_late_fees(bigint) to authenticated, service_role;

alter table public.fee_late_rule enable row level security;
drop policy if exists fee_late_rule_tenant on public.fee_late_rule;
create policy fee_late_rule_tenant on public.fee_late_rule as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists fee_late_rule_read on public.fee_late_rule;
create policy fee_late_rule_read on public.fee_late_rule for select to authenticated using ((select app.is_admin_scope()));
drop policy if exists fee_late_rule_write on public.fee_late_rule;
create policy fee_late_rule_write on public.fee_late_rule for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
grant select, insert, update, delete on public.fee_late_rule to authenticated;
grant all on public.fee_late_rule to service_role;
drop trigger if exists trg_log_change on public.fee_late_rule;
create trigger trg_log_change after insert or update or delete on public.fee_late_rule for each row execute function public.log_change('Late fee rule');

-- ------------------------------------------------------------ transport fees
alter table public.route add column if not exists annual_fee numeric(12,2) not null default 0 check (annual_fee >= 0);

create or replace function public.raise_instalment(p_instalment bigint, p_class bigint default null, p_section bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ins public.fee_instalment;
  v_school bigint; v_year bigint; v_first boolean; v_cum_prev numeric; v_cum numeric;
  v_actor bigint; v_made int := 0;
  st record; h record; c record;
  v_inv bigint; v_charges numeric; v_applicable numeric; v_off numeric; v_total numeric; v_bus numeric; v_route text;
begin
  select * into ins from public.fee_instalment where id = p_instalment;
  if not found then raise exception 'Instalment not found'; end if;
  v_school := ins.school_id; v_year := ins.academic_year_id;
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
      and not exists (select 1 from public.fee_invoice i where i.student_id = e.student_id and i.academic_year_id = v_year and i.status <> 'cancelled'
                      and (i.instalment_id = ins.id or lower(btrim(i.title)) = lower(btrim(ins.name))))
  loop
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

    -- transport, from the student's route this year
    select r.annual_fee, r.code into v_bus, v_route
      from public.student_transport t join public.route r on r.id = t.route_id
     where t.student_id = st.student_id and t.academic_year_id = v_year and t.is_active and r.annual_fee > 0
     order by t.id limit 1;
    if v_bus is not null then
      insert into pg_temp._lines values (null, round(v_bus * v_cum / 100, 2) - round(v_bus * v_cum_prev / 100, 2), 'transport', 'Transport (' || v_route || ')');
    end if;
    v_bus := null; v_route := null;

    delete from pg_temp._lines where amount <= 0;
    select coalesce(sum(amount), 0) into v_charges from pg_temp._lines;
    if v_charges <= 0 then continue; end if;

    if public.sibling_rank(st.student_id, v_year) >= 2 then
      insert into public.student_concession (school_id, student_id, concession_type_id, academic_year_id, is_auto, note)
      select v_school, st.student_id, t.id, v_year, true, 'Given automatically: second child or later'
      from public.fee_concession_type t
      where t.school_id = v_school and t.active and t.auto_rule = 'sibling'
      on conflict (student_id, concession_type_id, academic_year_id) do nothing;
    end if;

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

-- ------------------------------------------------------------ Finance posting
alter table public.fee_payment add column if not exists fin_voucher_id bigint;
create index if not exists idx_fee_payment_unposted on public.fee_payment (school_id) where fin_voucher_id is null;

-- Finance's write check also lets the nightly system job post (no signed-in
-- user and fin.system set inside this transaction only).
create or replace function fin.can_write(p_org uuid) returns boolean
language sql stable as $$
  select coalesce(fin.role(p_org) in ('admin', 'accountant'), false)
      or (auth.uid() is null and current_setting('fin.system', true) = '1')
$$;

-- Posts every not-yet-posted payment of one school (or all schools) to its
-- Finance books. Returns the number of journals posted. Schools without
-- Finance, or whose books are not set up, are skipped and stay unposted.
create or replace function public.post_fees_to_finance(p_school bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  sc record; d record; v_org uuid; v_cash bigint; v_bank bigint; v_fee bigint; v_bus bigint;
  v_vid bigint; v_n int := 0; v_line int; v_locked date; v_date date; v_fee_amt numeric;
begin
  if auth.uid() is not null then raise exception 'Fee posting runs automatically'; end if;
  perform set_config('fin.system', '1', true);
  for sc in
    select s.id, s.org_id from public.school s
    where s.org_id is not null and (p_school is null or s.id = p_school)
      and fin.subscribed(s.org_id) and exists (select 1 from fin.settings x where x.org_id = s.org_id)
      and exists (select 1 from public.fee_payment p where p.school_id = s.id and p.fin_voucher_id is null)
  loop
    v_org := sc.org_id;
    select id into v_cash from fin.account where org_id = v_org and code = '1110';
    select id into v_bank from fin.account where org_id = v_org and code = '1121';
    select id into v_fee  from fin.account where org_id = v_org and code = '4100';
    select id into v_bus  from fin.account where org_id = v_org and code = '4110';
    select books_locked_until into v_locked from fin.settings where org_id = v_org;
    if v_cash is null or v_bank is null or v_fee is null then continue; end if;
    v_bus := coalesce(v_bus, v_fee);

    for d in
      with p as (
        select p.id, p.paid_on, p.mode, (case when p.is_refund then -1 else 1 end) * p.amount amt,
               -- the transport part of a payment, in proportion to the invoice
               case when i.amount > 0 then (case when p.is_refund then -1 else 1 end) * p.amount *
                 coalesce((select sum(l.amount) from public.fee_invoice_line l where l.invoice_id = i.id and l.kind = 'transport' and not l.waived), 0) / i.amount
               else 0 end bus_amt
        from public.fee_payment p join public.fee_invoice i on i.id = p.invoice_id
        where p.school_id = sc.id and p.fin_voucher_id is null
          and p.created_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
      )
      select paid_on, array_agg(id) ids,
             round(sum(amt) filter (where mode = 'cash'), 2) cash_amt,
             round(sum(amt) filter (where mode <> 'cash'), 2) bank_amt,
             round(sum(bus_amt), 2) bus_amt, round(sum(amt), 2) total
      from p group by paid_on order by paid_on
    loop
      if coalesce(d.total, 0) = 0 and coalesce(d.cash_amt, 0) = 0 and coalesce(d.bank_amt, 0) = 0 then
        update public.fee_payment set fin_voucher_id = 0 where id = any(d.ids);
        continue;
      end if;
      v_date := case when v_locked is not null and d.paid_on <= v_locked then (now() at time zone 'Asia/Kolkata')::date else d.paid_on end;
      perform set_config('fin.internal', '1', true);
      insert into fin.voucher (org_id, kind, date, narration, status, created_by)
      values (v_org, 'journal', v_date, 'Fee collections from CampusTwin for ' || to_char(d.paid_on, 'DD/MM/YYYY'), 'draft', null)
      returning id into v_vid;
      perform set_config('fin.internal', '0', true);
      v_line := 0;
      -- debit (or credit, for net refunds) the cash and bank accounts
      if coalesce(d.cash_amt, 0) <> 0 then
        v_line := v_line + 1;
        insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit, memo)
        values (v_org, v_vid, v_line, v_cash, greatest(d.cash_amt, 0), greatest(-d.cash_amt, 0), 'Fees received in cash');
      end if;
      if coalesce(d.bank_amt, 0) <> 0 then
        v_line := v_line + 1;
        insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit, memo)
        values (v_org, v_vid, v_line, v_bank, greatest(d.bank_amt, 0), greatest(-d.bank_amt, 0), 'Fees received by UPI, card, bank or cheque');
      end if;
      -- credit income, split between fees and transport
      if coalesce(d.bus_amt, 0) <> 0 and v_bus <> v_fee then
        v_line := v_line + 1;
        insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit, memo)
        values (v_org, v_vid, v_line, v_bus, greatest(-d.bus_amt, 0), greatest(d.bus_amt, 0), 'Transport fees');
      end if;
      v_fee_amt := d.total - (case when v_bus <> v_fee then coalesce(d.bus_amt, 0) else 0 end);
      if v_fee_amt <> 0 then
        v_line := v_line + 1;
        insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit, memo)
        values (v_org, v_vid, v_line, v_fee, greatest(-v_fee_amt, 0), greatest(v_fee_amt, 0), 'School fees');
      end if;
      perform fin.post_voucher(v_vid);
      update public.fee_payment set fin_voucher_id = v_vid where id = any(d.ids);
      v_n := v_n + 1;
    end loop;
  end loop;
  perform set_config('fin.system', '0', true);
  return v_n;
end $$;
revoke all on function public.post_fees_to_finance(bigint) from public, anon, authenticated;
grant execute on function public.post_fees_to_finance(bigint) to service_role;

-- ------------------------------------------------------------ tuition certificate
-- Tuition paid by a student in a financial year (April to March): each payment
-- counts towards tuition in proportion to the tuition share of its invoice
-- (tuition heads less their share of concessions).
create or replace function public.tuition_paid(p_student bigint, p_fy_start date)
returns table (paid numeric, tuition numeric) language sql stable security definer set search_path = '' as $$
  with pays as (
    select p.amount * (case when p.is_refund then -1 else 1 end) amt, p.invoice_id
    from public.fee_payment p
    where p.student_id = p_student and p.paid_on >= p_fy_start and p.paid_on < (p_fy_start + interval '1 year')::date
      and ((select app.is_admin_scope()) or p_student in (select app.my_owned_students()))
  ),
  shares as (
    select i.id,
      case when sum(case when l.kind = 'concession' then 0 when l.waived then 0 else l.amount end) > 0 then
        greatest(0, sum(case when l.kind = 'charge' and h.is_tuition and not l.waived then l.amount else 0 end)
          * (1 - coalesce(sum(case when l.kind = 'concession' then l.amount else 0 end), 0)
               / nullif(sum(case when l.kind in ('charge') and not l.waived then l.amount else 0 end), 0)))
          / nullif(i.amount, 0)
      else 0 end share
    from public.fee_invoice i
    join public.fee_invoice_line l on l.invoice_id = i.id
    left join public.fee_head h on h.id = l.fee_head_id
    where i.id in (select invoice_id from pays)
    group by i.id, i.amount
  )
  select round(coalesce(sum(pays.amt), 0), 2), round(coalesce(sum(pays.amt * coalesce(shares.share, 0)), 0), 2)
  from pays left join shares on shares.id = pays.invoice_id;
$$;
revoke all on function public.tuition_paid(bigint, date) from public, anon;
grant execute on function public.tuition_paid(bigint, date) to authenticated;

-- ------------------------------------------------------------ nightly jobs (IST)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('fees-late-nightly', 'fees-finance-nightly');
  perform cron.schedule('fees-late-nightly', '30 20 * * *', 'select public.apply_late_fees()');      -- 02:00 IST
  perform cron.schedule('fees-finance-nightly', '45 20 * * *', 'select public.post_fees_to_finance()'); -- 02:15 IST
end $$;

commit;
