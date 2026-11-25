-- Eternity Finance self-test. Acts as four real logins (owner, accountant,
-- viewer, and the owner of another organisation) inside one transaction that
-- always ends with an exception, so nothing is kept. Success: 'FIN_TEST_PASSED'.
do $$
declare
  ua uuid; ub uuid; uc uuid; ud uuid;
  f uuid; g uuid;
  local_c bigint; other_c bigint; vendor bigint;
  fee bigint; sales bigint; rent bigint; bank bigint; grp bigint; recv bigint; capital bigint;
  inv1 bigint; inv2 bigint; inv3 bigint; bill bigint; rc bigint; rc2 bigint; jv bigint; jv2 bigint;
  num text; n int; x numeric; y numeric; d date := current_date;
begin
  select id into ua from auth.users order by created_at limit 1;
  select id into ub from auth.users where id <> ua order by created_at limit 1;
  select id into uc from auth.users where id not in (ua, ub) order by created_at limit 1;
  select id into ud from auth.users where id not in (ua, ub, uc) order by created_at limit 1;
  if ud is null then raise exception 'SETUP: need four logins'; end if;

  insert into core.organisation (name, kind) values ('Fin Test One', 'business') returning id into f;
  insert into core.organisation (name, kind) values ('Fin Test Two', 'business') returning id into g;
  insert into core.subscription (org_id, product_code, status) values (f, 'finance', 'active'), (g, 'finance', 'active');
  insert into core.membership (org_id, user_id, role) values (f, ua, 'owner'), (g, ud, 'owner')
    on conflict (org_id, user_id) do update set role = excluded.role;
  insert into fin.team (org_id, user_id, role) values (f, ub, 'accountant'), (f, uc, 'viewer');

  -- ------------------------------------------------------------ owner sets up
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if fin.role(f) <> 'admin' then raise exception 'FAIL 1: owner is not finance admin'; end if;
  perform fin.setup(f, '24', null);
  select count(*) into n from fin.account where org_id = f;
  if n < 45 then raise exception 'FAIL 1: only % accounts set up', n; end if;
  perform fin.setup(f, '24', null);
  select count(*) into x from fin.account where org_id = f;
  if x <> n then raise exception 'FAIL 1: setup twice duplicated accounts'; end if;
  reset role;

  select id into fee from fin.account where org_id = f and code = '4100';
  select id into sales from fin.account where org_id = f and code = '4200';
  select id into rent from fin.account where org_id = f and code = '5200';
  select id into bank from fin.account where org_id = f and code = '1121';
  select id into grp from fin.account where org_id = f and code = '1100';
  select id into recv from fin.account where org_id = f and code = '1130';
  select id into capital from fin.account where org_id = f and code = '3100';

  -- ------------------------------------------------------------ accountant works
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if fin.role(f) <> 'accountant' then raise exception 'FAIL 2: accountant role wrong'; end if;
  insert into fin.party (org_id, kind, name, state_code) values (f, 'customer', 'Local Parent', '24') returning id into local_c;
  insert into fin.party (org_id, kind, name, state_code) values (f, 'customer', 'Pune Client', '27') returning id into other_c;
  insert into fin.party (org_id, kind, name, state_code) values (f, 'vendor', 'Landlord', '24') returning id into vendor;

  -- intra-state invoice: 10,000 fee at 0% + 2 x 1,000 at 12% = 12,000 + 240 GST
  insert into fin.voucher (org_id, kind, date, party_id) values (f, 'sales_invoice', d, local_c) returning id into inv1;
  insert into fin.voucher_item (org_id, voucher_id, line_no, description, account_id, qty, rate, tax_rate) values
    (f, inv1, 1, 'Tuition fee', fee, 1, 10000, 0), (f, inv1, 2, 'Uniform', sales, 2, 1000, 12);
  select fin.post_voucher(inv1) into num;
  if num <> 'INV/' || fin.fy(d) || '/0001' then raise exception 'FAIL 3: number %', num; end if;
  select total into x from fin.voucher where id = inv1;
  if x <> 12240 then raise exception 'FAIL 3: invoice total %', x; end if;
  select count(*) into n from fin.gl_entry where voucher_id = inv1;
  if n <> 5 then raise exception 'FAIL 3: % ledger rows, expected 5 (party, 2 income, CGST, SGST)', n; end if;
  select sum(debit) - sum(credit) into x from fin.gl_entry where voucher_id = inv1;
  if x <> 0 then raise exception 'FAIL 3: invoice does not balance'; end if;
  select credit into x from fin.gl_entry g join fin.account a on a.id = g.account_id where g.voucher_id = inv1 and a.code = '2110';
  if x <> 120 then raise exception 'FAIL 3: CGST %', x; end if;

  -- inter-state invoice: IGST
  insert into fin.voucher (org_id, kind, date, party_id) values (f, 'sales_invoice', d, other_c) returning id into inv2;
  insert into fin.voucher_item (org_id, voucher_id, line_no, description, account_id, qty, rate, tax_rate) values
    (f, inv2, 1, 'Consulting', sales, 1, 5000, 18);
  select fin.post_voucher(inv2) into num;
  if num <> 'INV/' || fin.fy(d) || '/0002' then raise exception 'FAIL 4: second number %', num; end if;
  select credit into x from fin.gl_entry g join fin.account a on a.id = g.account_id where g.voucher_id = inv2 and a.code = '2112';
  if x <> 900 then raise exception 'FAIL 4: IGST %', x; end if;

  -- receipt of 10,000 against the first invoice
  insert into fin.voucher (org_id, kind, date, party_id, cash_account_id, amount) values (f, 'receipt', d, local_c, bank, 10000) returning id into rc;
  insert into fin.allocation (org_id, voucher_id, against_id, amount) values (f, rc, inv1, 10000);
  perform fin.post_voucher(rc);
  if fin.outstanding(inv1) <> 2240 then raise exception 'FAIL 5: outstanding %', fin.outstanding(inv1); end if;

  -- matching more than is due is refused
  insert into fin.voucher (org_id, kind, date, party_id, cash_account_id, amount) values (f, 'receipt', d, local_c, bank, 3000) returning id into rc2;
  insert into fin.allocation (org_id, voucher_id, against_id, amount) values (f, rc2, inv1, 3000);
  begin
    perform fin.post_voucher(rc2);
    raise exception 'FAIL 6: over-payment accepted';
  exception when raise_exception then
    if sqlerrm not like '%more than the%still due%' then raise; end if;
  end;

  -- matching another party's invoice is refused
  update fin.allocation set amount = 100, against_id = inv2 where voucher_id = rc2;
  begin
    perform fin.post_voucher(rc2);
    raise exception 'FAIL 6: matched another party''s invoice';
  exception when raise_exception then
    if sqlerrm not like '%not an open invoice of this party%' then raise; end if;
  end;

  -- a posted invoice cannot be edited, and its lines cannot change
  begin
    update fin.voucher set narration = 'changed' where id = inv1;
    raise exception 'FAIL 7: posted invoice edited';
  exception when raise_exception then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
  begin
    update fin.voucher_item set rate = 1 where voucher_id = inv1;
    raise exception 'FAIL 7: posted line edited';
  exception when raise_exception then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
  begin
    insert into fin.gl_entry (org_id, voucher_id, date, account_id, debit) values (f, inv1, d, bank, 1);
    raise exception 'FAIL 7: ledger written directly';
  exception when insufficient_privilege then null;
  end;

  -- cancelling: blocked while paid, allowed after the receipt is cancelled
  begin
    perform fin.cancel_voucher(inv1);
    raise exception 'FAIL 8: cancelled a paid invoice';
  exception when raise_exception then
    if sqlerrm not like '%cancel those first%' then raise; end if;
  end;
  perform fin.cancel_voucher(rc);
  perform fin.cancel_voucher(inv1);
  select sum(debit) - sum(credit) into x from fin.gl_entry where voucher_id = inv1 and account_id = recv;
  if x <> 0 then raise exception 'FAIL 8: cancelled invoice still owed %', x; end if;

  -- journals: must balance, cannot use group accounts
  insert into fin.voucher (org_id, kind, date, narration) values (f, 'journal', d, 'Capital brought in') returning id into jv;
  insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit) values
    (f, jv, 1, bank, 50000, 0), (f, jv, 2, capital, 0, 40000);
  begin
    perform fin.post_voucher(jv);
    raise exception 'FAIL 9: unbalanced journal posted';
  exception when raise_exception then
    if sqlerrm not like 'Debits%must be equal' then raise; end if;
  end;
  update fin.journal_line set credit = 50000 where voucher_id = jv and line_no = 2;
  select fin.post_voucher(jv) into num;
  if num not like 'JV/%/0001' then raise exception 'FAIL 9: journal number %', num; end if;
  insert into fin.voucher (org_id, kind, date) values (f, 'journal', d) returning id into jv2;
  insert into fin.journal_line (org_id, voucher_id, line_no, account_id, debit, credit) values
    (f, jv2, 1, grp, 10, 0), (f, jv2, 2, capital, 0, 10);
  begin
    perform fin.post_voucher(jv2);
    raise exception 'FAIL 9: posted to a group account';
  exception when raise_exception then
    if sqlerrm not like '%account that can be posted to%' then raise; end if;
  end;

  -- purchase bill within the state: input CGST and SGST
  insert into fin.voucher (org_id, kind, date, party_id, reference) values (f, 'purchase_bill', d, vendor, 'R-77') returning id into bill;
  insert into fin.voucher_item (org_id, voucher_id, line_no, description, account_id, qty, rate, tax_rate) values
    (f, bill, 1, 'Office rent', rent, 1, 20000, 18);
  perform fin.post_voucher(bill);
  select debit into x from fin.gl_entry g join fin.account a on a.id = g.account_id where g.voucher_id = bill and a.code = '1140';
  if x <> 1800 then raise exception 'FAIL 10: input CGST %', x; end if;

  -- the accountant cannot lock the books
  update fin.settings set books_locked_until = d where org_id = f;
  reset role;
  select count(*) into n from fin.settings where org_id = f and books_locked_until is not null;
  if n <> 0 then raise exception 'FAIL 11: accountant locked the books'; end if;

  -- the whole ledger balances, and the trial balance sums to zero
  select sum(debit) - sum(credit) into x from fin.gl_entry where org_id = f;
  if x <> 0 then raise exception 'FAIL 12: ledger out by %', x; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select sum(closing) into x from fin.trial_balance(f, d - 30, d);
  if x <> 0 then raise exception 'FAIL 12: trial balance out by %', x; end if;
  select sum(igst) into x from fin.gst_summary(f, d, d) where side = 'output';
  if x <> 900 then raise exception 'FAIL 12: GST summary IGST %', x; end if;

  -- owner locks the books; nothing on or before that date can be posted
  update fin.settings set books_locked_until = d where org_id = f;
  insert into fin.voucher (org_id, kind, date, party_id) values (f, 'sales_invoice', d, local_c) returning id into inv3;
  insert into fin.voucher_item (org_id, voucher_id, line_no, description, account_id, qty, rate) values (f, inv3, 1, 'Late fee', fee, 1, 100);
  begin
    perform fin.post_voucher(inv3);
    raise exception 'FAIL 13: posted into locked books';
  exception when raise_exception then
    if sqlerrm not like '%locked%' then raise; end if;
  end;
  reset role;

  -- ------------------------------------------------------------ viewer and outsider
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from fin.voucher where org_id = f;
  if n = 0 then raise exception 'FAIL 14: viewer cannot read'; end if;
  begin
    insert into fin.party (org_id, name) values (f, 'Viewer Party');
    raise exception 'FAIL 14: viewer wrote';
  exception when insufficient_privilege then null;
  end;
  begin
    perform fin.post_voucher(inv3);
    raise exception 'FAIL 14: viewer posted';
  exception when raise_exception then
    if sqlerrm not like '%cannot post%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from fin.voucher where org_id = f;
  if n <> 0 then raise exception 'FAIL 15: other organisation sees % vouchers', n; end if;
  select count(*) into n from fin.gl_entry where org_id = f;
  if n <> 0 then raise exception 'FAIL 15: other organisation sees the ledger'; end if;
  select count(*) into n from fin.trial_balance(f, d - 30, d);
  if n <> 0 then raise exception 'FAIL 15: other organisation runs our trial balance'; end if;
  begin
    insert into fin.voucher (org_id, kind, date) values (f, 'journal', d);
    raise exception 'FAIL 15: other organisation wrote';
  exception when insufficient_privilege then null;
  end;
  reset role;

  begin
    set local role anon;
    perform 1 from fin.voucher limit 1;
    raise exception 'FAIL 16: anon can read finance';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 18. an account with entries cannot be deleted (checked when the change is saved)
  begin
    delete from fin.account where id = fee;
    set constraints all immediate;
    raise exception 'FAIL 18: deleted an account that has entries';
  exception when foreign_key_violation then null;
  end;
  set constraints all deferred;

  -- 17. an organisation with books can still be removed
  delete from core.organisation where id = f;
  select count(*) into n from fin.gl_entry where org_id = f;
  if n <> 0 then raise exception 'FAIL 17: ledger left behind'; end if;

  raise exception 'FIN_TEST_PASSED';
end $$;
