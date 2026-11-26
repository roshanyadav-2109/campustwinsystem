-- Self-test for 0104 on Greenfield (8). The gateway steps run as service_role,
-- like the server's connector. Rolled back.
begin;
do $$ declare pa uuid := gen_random_uuid(); of uuid := gen_random_uuid(); ct uuid := gen_random_uuid();
  v_g bigint; v_kid bigint; v_other bigint; v_inv bigint; v_inv2 bigint; v_inv3 bigint; v_y bigint; v_sec bigint; v_staff bigint; v_ctstaff bigint; v_gw bigint;
  o record; o2 record; r record; ok boolean; c int;
begin
  select gs.guardian_id, gs.student_id into v_g, v_kid from public.guardian_student gs where gs.school_id = 8 limit 1;
  select e.student_id into v_other from public.student_enrollment e where e.school_id = 8 and e.student_id not in (select student_id from public.guardian_student where guardian_id = v_g) limit 1;
  select e.academic_year_id, e.section_id into v_y, v_sec from public.student_enrollment e where e.student_id = v_kid order by e.academic_year_id desc limit 1;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id) values
    (v_kid, v_sec, v_y, 'QA online', 2500, 0, current_date + 5, 'due', 8) returning id into v_inv;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id) values
    (v_other, v_sec, v_y, 'QA other family', 999, 0, current_date + 5, 'due', 8) returning id into v_inv2;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id) values
    (v_kid, v_sec, v_y, 'QA second bill', 1000, 0, current_date + 5, 'due', 8) returning id into v_inv3;
  insert into auth.users (id, email, aud, role) values (pa, 'qa-pay-parent@example.com', 'authenticated', 'authenticated'),
    (of, 'qa-pay-office@example.com', 'authenticated', 'authenticated'), (ct, 'qa-pay-ct@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA Pay Parent', 8, v_g);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Pay Office', 'qa-pay-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Pay Office', 8, v_staff);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Pay CT', 'qa-pay-ct@example.com', 'class_teacher') returning id into v_ctstaff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (ct, 'staff', 'QA Pay CT', 8, v_ctstaff);

  -- not switched on yet
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_payment_order(v_inv); exception when others then ok := sqlerrm like '%not switched on%'; end;
  if not ok then raise exception 'FAIL order without a gateway'; end if;
  reset role;

  -- the office adds the test gateway and keys
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.payment_gateway (provider, mode) values ('test', 'test') returning id into v_gw;
  ok := false; begin update public.payment_gateway set active = true where id = v_gw; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL office switched a gateway on directly'; end if;
  ok := false; begin perform public.set_active_gateway(v_gw, array['razorpay']); exception when others then ok := sqlerrm like '%not connected%'; end;
  if not ok then raise exception 'FAIL gateway without a connector switched on'; end if;
  perform public.set_active_gateway(v_gw, array['test']);
  perform public.set_payment_gateway_secret(v_gw, '{"key":"QA"}');
  ok := false; begin update public.payment_gateway set secret_id = gen_random_uuid() where id = v_gw; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL office set secret_id'; end if;
  ok := false; begin insert into public.payment_gateway (provider, mode) values ('test', 'live'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL test gateway in live mode'; end if;
  reset role;

  -- staff (even the office, who sees every student) cannot open a payment for a family
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_payment_order(v_inv); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL staff opened a payment for a family'; end if;
  reset role;

  -- the parent: own bill only; a second click reuses the open attempt
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into o from public.create_payment_order(v_inv);
  if o.amount <> 2500 or o.provider <> 'test' or o.mode <> 'test' then raise exception 'FAIL order %', o; end if;
  select * into o2 from public.create_payment_order(v_inv);
  if o2.order_public_id <> o.order_public_id then raise exception 'FAIL second click made a second attempt'; end if;
  ok := false; begin perform public.create_payment_order(v_inv2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent opened another family''s bill'; end if;
  ok := false; begin perform public.complete_payment_order(o.order_public_id, 'x', 2500); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent completed their own payment'; end if;
  if (select count(*) from public.payment_gateway) <> 0 then raise exception 'FAIL parent reads gateway settings'; end if;
  reset role;

  -- the connector (service role)
  set local role service_role;
  if (select secret from public.payment_order_for_gateway(o.order_public_id)) <> '{"key":"QA"}' then raise exception 'FAIL connector cannot read keys'; end if;
  if (select payer_email from public.payment_order_for_gateway(o.order_public_id)) <> 'qa-pay-parent@example.com' then raise exception 'FAIL payer contact'; end if;
  -- less money than the bill: kept for review, nothing credited, nothing lost
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_short', 100);
  if r.ok or (select status from public.payment_order where public_id = o.order_public_id) <> 'review'
     or (select refund_due from public.payment_order where public_id = o.order_public_id) <> 100 then raise exception 'FAIL short payment: %', r; end if;
  reset role;

  -- a fresh attempt; meanwhile the office takes cash for part of the bill
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into o from public.create_payment_order(v_inv);
  reset role;
  insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode) values (8, v_inv, 1000, current_date, 'cash');
  set local role service_role;
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_A', 2500, null, now(), 'upi', 5);
  if not r.ok or r.receipt_no is null then raise exception 'FAIL payment not credited: %', r; end if;
  select credited_amount, refund_due, status into o2 from public.payment_order where public_id = o.order_public_id;
  if o2.credited_amount <> 1500 or o2.refund_due <> 1000 or o2.status <> 'paid' then raise exception 'FAIL cash in between: %', o2; end if;
  -- the same confirmation again: one receipt
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_A', 2500);
  if not r.ok or r.message <> 'Already recorded' then raise exception 'FAIL duplicate: %', r; end if;
  -- a second, different payment for the same attempt: kept for review
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_B', 2500);
  if r.ok or (select status from public.payment_order where public_id = o.order_public_id) <> 'review' then raise exception 'FAIL second payment id: %', r; end if;
  reset role;
  if (select count(*) from public.fee_payment where invoice_id = v_inv and mode = 'online') <> 1 then raise exception 'FAIL receipts'; end if;
  if (select status from public.fee_invoice where id = v_inv) <> 'paid' then raise exception 'FAIL bill not settled'; end if;
  -- test receipts are marked and never posted to Finance
  if not (select is_test and fin_voucher_id = 0 and note like 'TEST%' from public.fee_payment where invoice_id = v_inv and mode = 'online') then raise exception 'FAIL test receipt not marked'; end if;

  -- an expired attempt that the bank confirms late is still credited
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into o from public.create_payment_order(v_inv3);
  reset role;
  update public.payment_order set status = 'expired' where public_id = o.order_public_id;
  set local role service_role;
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_late', 1000);
  if not r.ok then raise exception 'FAIL late success lost: %', r; end if;
  -- refund through the gateway: a refund receipt, once
  select * into r from public.refund_payment_order(o.order_public_id, 400, 'rf_1');
  if not r.ok then raise exception 'FAIL refund: %', r; end if;
  select * into r from public.refund_payment_order(o.order_public_id, 400, 'rf_1');
  if r.message <> 'Already recorded' then raise exception 'FAIL refund twice'; end if;
  select * into r from public.refund_payment_order(o.order_public_id, 5000, 'rf_2');
  if r.ok then raise exception 'FAIL refund above received'; end if;
  reset role;
  if (select paid_amount from public.fee_invoice where id = v_inv3) <> 600 then raise exception 'FAIL refund not on the bill: %', (select paid_amount from public.fee_invoice where id = v_inv3); end if;
  -- a real school cannot use the test gateway
  ok := false; begin insert into public.payment_gateway (school_id, provider, mode) values (1, 'test', 'test'); exception when others then ok := sqlerrm like '%demo institutions%'; end;
  if not ok then raise exception 'FAIL test gateway at a real school'; end if;
  -- the log cannot be changed
  ok := false; begin update public.payment_event set kind = 'x' where school_id = 8; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL payment log changed'; end if;
end $$;
rollback;
