-- Self-test for 0066 on Greenfield (school 8, current year). Everything is
-- rolled back. Raises "FAIL ..." on the first problem; no output means pass.
begin;
do $$
declare
  v_school bigint := 8; v_year bigint; v_class bigint; v_kid bigint; v_sib bigint; v_other bigint;
  i1 bigint; i2 bigint; i3 bigint; v_once bigint; v_conc bigint; v_sibt bigint;
  v_annual numeric; v_once_amt numeric; n int; v numeric; v_inv bigint; v_line bigint; v_status text;
begin
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  -- a class with a fee structure and at least 3 enrolled students
  select fs.class_id into v_class from public.fee_structure fs
   where fs.academic_year_id = v_year group by fs.class_id
   having (select count(*) from public.student_enrollment e join public.section s on s.id = e.section_id
           where s.class_id = fs.class_id and e.academic_year_id = v_year and e.status <> 'transferred') >= 3
   order by fs.class_id limit 1;
  if v_class is null then raise exception 'FAIL setup: no class with fees'; end if;
  select e.student_id into v_kid from public.student_enrollment e join public.section s on s.id = e.section_id
   where s.class_id = v_class and e.academic_year_id = v_year and e.status <> 'transferred' order by e.student_id limit 1;
  select e.student_id into v_other from public.student_enrollment e join public.section s on s.id = e.section_id
   where s.class_id = v_class and e.academic_year_id = v_year and e.status <> 'transferred' order by e.student_id offset 1 limit 1;

  -- make one head "once"; an odd amount so splitting in three leaves paise
  select fs.fee_head_id into v_once from public.fee_structure fs where fs.academic_year_id = v_year and fs.class_id = v_class order by fs.fee_head_id limit 1;
  update public.fee_head set charge = 'once' where id = v_once;
  update public.fee_structure set amount = 1000 where academic_year_id = v_year and class_id = v_class and fee_head_id = v_once;
  update public.fee_structure set amount = 10000.01 where academic_year_id = v_year and class_id = v_class and fee_head_id <> v_once;
  select sum(amount) into v_annual from public.fee_structure fs join public.fee_head h on h.id = fs.fee_head_id
   where fs.academic_year_id = v_year and fs.class_id = v_class and h.is_active and fs.amount > 0;

  -- three instalments that do not split evenly
  delete from public.fee_instalment where academic_year_id = v_year;
  insert into public.fee_instalment (school_id, academic_year_id, seq, name, due_date, share_pct) values
    (v_school, v_year, 1, 'QA Term 1', '2027-04-10', 33.333) returning id into i1;
  insert into public.fee_instalment (school_id, academic_year_id, seq, name, due_date, share_pct) values
    (v_school, v_year, 2, 'QA Term 2', '2027-07-10', 33.333) returning id into i2;
  insert into public.fee_instalment (school_id, academic_year_id, seq, name, due_date, share_pct) values
    (v_school, v_year, 3, 'QA Term 3', '2027-10-10', 33.334) returning id into i3;

  -- a 100% concession for v_other (an RTE seat): every invoice must be paid at zero
  insert into public.fee_concession_type (school_id, name, kind, value) values (v_school, 'QA RTE', 'percent', 100) returning id into v_conc;
  insert into public.student_concession (school_id, student_id, concession_type_id, academic_year_id) values (v_school, v_other, v_conc, v_year);

  perform public.raise_instalment(i1, v_class);
  perform public.raise_instalment(i2, v_class);
  perform public.raise_instalment(i3, v_class);

  -- the year adds up exactly for a student without concessions
  select sum(amount) into v from public.fee_invoice where student_id = v_kid and instalment_id in (i1, i2, i3);
  if v is distinct from v_annual then raise exception 'FAIL year total % <> annual %', v, v_annual; end if;
  -- the "once" head appears only on the first instalment
  select count(*) into n from public.fee_invoice_line l join public.fee_invoice i on i.id = l.invoice_id
   where i.student_id = v_kid and l.fee_head_id = v_once and i.instalment_id in (i2, i3);
  if n <> 0 then raise exception 'FAIL once head on later instalments'; end if;
  -- the invoice total equals its lines
  select count(*) into n from public.fee_invoice i where i.instalment_id in (i1, i2, i3) and i.amount <> public.fee_invoice_total(i.id);
  if n <> 0 then raise exception 'FAIL % invoices differ from their lines', n; end if;
  -- full concession: zero and paid
  select count(*) into n from public.fee_invoice where student_id = v_other and instalment_id in (i1, i2, i3) and (amount <> 0 or status <> 'paid');
  if n <> 0 then raise exception 'FAIL RTE invoices not zero/paid'; end if;
  select count(*) into n from public.fee_invoice_line l join public.fee_invoice i on i.id = l.invoice_id
   where i.student_id = v_other and l.kind = 'concession' and l.label = 'QA RTE';
  if n <> 3 then raise exception 'FAIL concession lines %', n; end if;

  -- raising again creates nothing
  if public.raise_instalment(i1, v_class) <> 0 then raise exception 'FAIL re-raise duplicated'; end if;

  -- a late fee line then a waiver recompute the invoice
  select id, amount into v_inv, v from public.fee_invoice where student_id = v_kid and instalment_id = i2;
  insert into public.fee_invoice_line (invoice_id, amount, kind, label, school_id) values (v_inv, 50, 'late_fee', 'Late fee', v_school) returning id into v_line;
  if (select amount from public.fee_invoice where id = v_inv) <> v + 50 then raise exception 'FAIL late fee not added'; end if;
  update public.fee_invoice_line set waived = true, waive_reason = 'QA' where id = v_line;
  if (select amount from public.fee_invoice where id = v_inv) <> v then raise exception 'FAIL waiver not applied'; end if;

  -- a payment settles paid and status in the database
  insert into public.fee_payment (school_id, invoice_id, amount, mode) values (v_school, v_inv, 100, 'cash');
  select status into v_status from public.fee_invoice where id = v_inv;
  if v_status <> 'part' or (select paid_amount from public.fee_invoice where id = v_inv) <> 100 then raise exception 'FAIL payment settle (%)', v_status; end if;

  -- siblings: an automatic concession lands on the younger child only
  select gs2.student_id into v_sib from public.guardian_student gs1 join public.guardian_student gs2 on gs2.guardian_id = gs1.guardian_id and gs2.student_id <> gs1.student_id
   join public.student_enrollment e on e.student_id = gs2.student_id and e.academic_year_id = v_year
   join public.student_enrollment e1 on e1.student_id = gs1.student_id and e1.academic_year_id = v_year
   where gs1.school_id = v_school limit 1;
  if v_sib is not null then
    insert into public.fee_concession_type (school_id, name, kind, value, auto_rule) values (v_school, 'QA Sibling', 'percent', 10, 'sibling') returning id into v_sibt;
    perform public.raise_instalment(i1);   -- whole school
    select count(*) into n from public.student_concession sc where sc.concession_type_id = v_sibt and public.sibling_rank(sc.student_id, v_year) < 2;
    if n <> 0 then raise exception 'FAIL sibling concession given to an eldest child'; end if;
    select count(*) into n from public.student_concession sc where sc.concession_type_id = v_sibt;
    if n = 0 then raise exception 'FAIL no sibling concessions given'; end if;
  end if;
end $$;
rollback;
