-- Self-test for 0069/0070 on Greenfield (school 8). Rolled back.
-- Raises "FAIL ..." on the first problem; no output means pass.
begin;
do $$
declare
  v_school bigint := 8; v_year bigint; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  n int; m int; v numeric; v2 numeric; v_inv bigint; v_due date; v_route bigint; v_rider bigint; v_class bigint;
  i1 bigint; v_audit_before int; v_pay bigint; v_vid bigint; v_org uuid; v_dr numeric; v_cr numeric; r record;
begin
  select id into v_year from public.academic_year where school_id = v_school and is_current;

  -- ---------------------------------------------------------------- late fees
  -- nothing happens while the rule is off
  insert into public.fee_late_rule (school_id, enabled, grace_days, kind, amount, max_amount, applies_from)
  values (v_school, false, 5, 'per_week', 50, 200, null);
  if public.apply_late_fees(v_school) <> 0 then raise exception 'FAIL late fees applied while switched off'; end if;

  -- the preview needs a signed-in school, so compare with a direct count instead
  select count(*) into m from public.fee_invoice i where i.school_id = v_school and i.status in ('due','part') and v_today - i.due_date > 5;
  update public.fee_late_rule set enabled = true where school_id = v_school;
  select count(*) into v_audit_before from public.audit_log where school_id = v_school;
  n := public.apply_late_fees(v_school);
  if n <> m then raise exception 'FAIL late fees on % invoices, expected %', n, m; end if;
  if m > 0 then
    -- one summary line in the activity log, not one per invoice
    if (select count(*) from public.audit_log where school_id = v_school) - v_audit_before <> 1 then
      raise exception 'FAIL activity log got % rows', (select count(*) from public.audit_log where school_id = v_school) - v_audit_before;
    end if;
    -- amounts follow the rule and the cap, and invoice totals include them
    select i.id, i.due_date into v_inv, v_due from public.fee_invoice i where i.school_id = v_school and i.status in ('due','part') and v_today - i.due_date > 5 order by i.due_date limit 1;
    select amount into v from public.fee_invoice_line where invoice_id = v_inv and kind = 'late_fee';
    if v <> least(200, 50 * ceil((v_today - v_due - 5) / 7.0)) then raise exception 'FAIL late fee % for % days', v, v_today - v_due; end if;
    if (select amount from public.fee_invoice where id = v_inv) <> public.fee_invoice_total(v_inv) then raise exception 'FAIL total not updated'; end if;
    -- running again changes nothing
    if public.apply_late_fees(v_school) <> 0 then raise exception 'FAIL second run changed invoices'; end if;
    -- a waived late fee stays waived
    update public.fee_invoice_line set waived = true, waive_reason = 'QA' where invoice_id = v_inv and kind = 'late_fee';
    update public.fee_late_rule set max_amount = 500 where school_id = v_school;
    perform public.apply_late_fees(v_school);
    if not (select waived from public.fee_invoice_line where invoice_id = v_inv and kind = 'late_fee') then raise exception 'FAIL waiver undone'; end if;
  end if;
  -- only bills due after the rule's start date
  delete from public.fee_invoice_line where kind = 'late_fee' and school_id = v_school;
  update public.fee_late_rule set applies_from = v_today where school_id = v_school;
  if public.apply_late_fees(v_school) <> 0 then raise exception 'FAIL old bills charged after a start date'; end if;

  -- ---------------------------------------------------------------- transport
  select t.route_id, t.student_id, s.class_id into v_route, v_rider, v_class
    from public.student_transport t join public.student_enrollment e on e.student_id = t.student_id and e.academic_year_id = v_year
    join public.section s on s.id = e.section_id
   where t.school_id = v_school and t.is_active and t.academic_year_id = v_year limit 1;
  if v_rider is null then raise exception 'FAIL setup: no bus rider'; end if;
  update public.route set annual_fee = 12000 where id = v_route;
  delete from public.fee_instalment where academic_year_id = v_year;
  insert into public.fee_instalment (school_id, academic_year_id, seq, name, due_date, share_pct) values (v_school, v_year, 1, 'QA Half 1', '2027-04-10', 50) returning id into i1;
  insert into public.fee_concession_type (school_id, name, kind, value) values (v_school, 'QA Full', 'percent', 100);
  insert into public.student_concession (school_id, student_id, concession_type_id, academic_year_id)
    select v_school, v_rider, id, v_year from public.fee_concession_type where name = 'QA Full' and school_id = v_school;
  perform public.raise_instalment(i1, v_class);
  select i.id, i.amount into v_inv, v from public.fee_invoice i where i.student_id = v_rider and i.instalment_id = i1;
  if (select amount from public.fee_invoice_line where invoice_id = v_inv and kind = 'transport') <> 6000 then raise exception 'FAIL transport line'; end if;
  -- a 100% concession leaves transport to pay
  if v <> 6000 then raise exception 'FAIL concession touched transport (total %)', v; end if;

  -- ---------------------------------------------------------------- Finance
  select org_id into v_org from public.school where id = v_school;
  insert into public.fee_payment (school_id, invoice_id, amount, mode, paid_on) values (v_school, v_inv, 3000, 'cash', v_today - 1) returning id into v_pay;
  insert into public.fee_payment (school_id, invoice_id, amount, mode, paid_on) values (v_school, v_inv, 1000, 'upi', v_today - 1);
  update public.fee_payment set created_at = now() - interval '1 day' where invoice_id = v_inv;
  n := public.post_fees_to_finance(v_school);
  if n <> 1 then raise exception 'FAIL posted % journals, expected 1', n; end if;
  select fin_voucher_id into v_vid from public.fee_payment where id = v_pay;
  if (select status from fin.voucher where id = v_vid) <> 'posted' then raise exception 'FAIL voucher not posted'; end if;
  select sum(debit), sum(credit) into v_dr, v_cr from fin.gl_entry where voucher_id = v_vid;
  if v_dr <> 4000 or v_cr <> 4000 then raise exception 'FAIL ledger % / %', v_dr, v_cr; end if;
  -- cash 3000, bank 1000; the whole invoice is transport so income goes to Transport income
  if (select debit from fin.gl_entry g join fin.account a on a.id = g.account_id where g.voucher_id = v_vid and a.code = '1110') <> 3000 then raise exception 'FAIL cash line'; end if;
  if (select credit from fin.gl_entry g join fin.account a on a.id = g.account_id where g.voucher_id = v_vid and a.code = '4110') <> 4000 then raise exception 'FAIL transport income'; end if;
  if public.post_fees_to_finance(v_school) <> 0 then raise exception 'FAIL posted twice'; end if;
  -- payments made today wait for tonight
  insert into public.fee_payment (school_id, invoice_id, amount, mode) values (v_school, v_inv, 10, 'cash');
  if public.post_fees_to_finance(v_school) <> 0 then raise exception 'FAIL posted today''s payment early'; end if;
end $$;
rollback;
