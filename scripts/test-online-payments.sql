-- Self-test for 0098 on Greenfield (8). Rolled back.
begin;
do $$ declare pa uuid := gen_random_uuid(); of uuid := gen_random_uuid(); v_g bigint; v_kid bigint; v_other bigint; v_inv bigint; v_inv2 bigint; v_y bigint; v_sec bigint;
  v_staff bigint; o record; r record; ok boolean; v_paid numeric; c int;
begin
  select gs.guardian_id, gs.student_id into v_g, v_kid from public.guardian_student gs where gs.school_id = 8 limit 1;
  select e.student_id into v_other from public.student_enrollment e where e.school_id = 8 and e.student_id not in (select student_id from public.guardian_student where guardian_id = v_g) limit 1;
  select e.academic_year_id, e.section_id into v_y, v_sec from public.student_enrollment e where e.student_id = v_kid order by e.academic_year_id desc limit 1;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id)
    values (v_kid, v_sec, v_y, 'QA online', 2500, 0, current_date + 5, 'due', 8) returning id into v_inv;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id)
    values (v_other, v_sec, v_y, 'QA other family', 999, 0, current_date + 5, 'due', 8) returning id into v_inv2;
  insert into auth.users (id, email, aud, role) values (pa, 'qa-pay-parent@example.com', 'authenticated', 'authenticated'), (of, 'qa-pay-office@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA Pay Parent', 8, v_g);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Pay Office', 'qa-pay-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Pay Office', 8, v_staff);

  -- not switched on yet
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_payment_order(v_inv); exception when others then ok := sqlerrm like '%not switched on%'; end;
  if not ok then raise exception 'FAIL order without a gateway'; end if;
  reset role;

  -- the office chooses the test gateway and stores keys
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.payment_gateway_setting (provider, mode) values ('test', 'sandbox');
  perform public.set_payment_secret('{"key":"QA"}');
  ok := false; begin update public.payment_gateway_setting set secret_id = gen_random_uuid(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL office set secret_id'; end if;
  reset role;

  -- the parent pays their own child's bill; the amount is the balance
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into o from public.create_payment_order(v_inv);
  if o.amount <> 2500 or o.provider <> 'test' then raise exception 'FAIL order %', o; end if;
  ok := false; begin perform public.create_payment_order(v_inv2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent opened an order for another family'; end if;
  ok := false; begin perform public.complete_payment_order(o.order_public_id, 'x', 2500); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent completed their own payment'; end if;
  ok := false; begin perform public.payment_order_for_gateway(o.order_public_id); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent read gateway keys'; end if;
  if (select count(*) from public.payment_gateway_setting) <> 0 then raise exception 'FAIL parent reads gateway settings'; end if;
  reset role;

  -- the connector sees the keys; a wrong amount is refused; the right one credited once
  if (select secret from public.payment_order_for_gateway(o.order_public_id)) <> '{"key":"QA"}' then raise exception 'FAIL connector cannot read keys'; end if;
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_1', 100);
  if r.ok then raise exception 'FAIL wrong amount accepted'; end if;
  select * into o from (select * from public.payment_order where invoice_id = v_inv order by id desc limit 1) x;
  -- after a failure the parent starts again
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into o from public.create_payment_order(v_inv);
  reset role;
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_2', 2500);
  if not r.ok or r.receipt_no is null then raise exception 'FAIL payment not credited: %', r; end if;
  select * into r from public.complete_payment_order(o.order_public_id, 'pay_2', 2500);
  if not r.ok or r.message <> 'Already recorded' then raise exception 'FAIL duplicate callback: %', r; end if;
  select count(*) into c from public.fee_payment where invoice_id = v_inv;
  if c <> 1 then raise exception 'FAIL % receipts for one payment', c; end if;
  select status, paid_amount into r from public.fee_invoice where id = v_inv;
  if r.status <> 'paid' or r.paid_amount <> 2500 then raise exception 'FAIL bill not settled: %', r; end if;
  if (select mode from public.fee_payment where invoice_id = v_inv) <> 'online' then raise exception 'FAIL mode'; end if;
  -- a paid bill cannot be paid again
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.create_payment_order(v_inv); exception when others then ok := sqlerrm like '%already paid%'; end;
  if not ok then raise exception 'FAIL paid bill reopened'; end if;
  -- the parent sees their own orders
  if (select count(*) from public.payment_order where invoice_id = v_inv) < 2 then raise exception 'FAIL parent cannot see own orders'; end if;
  reset role;
end $$;
rollback;
