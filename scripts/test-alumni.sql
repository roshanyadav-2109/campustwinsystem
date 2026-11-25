-- Eternity Alumni self-test. Acts as four real logins (an admin, an editor, a
-- verified alumnus, and the admin of another organisation) inside one
-- transaction that always ends with an exception, so nothing is kept.
-- Success: 'ALUM_TEST_PASSED'.
do $$
declare
  ua uuid; ub uuid; uc uuid; ud uuid; ec text;
  a uuid; b uuid;
  m_c bigint; m_other bigint; m_pending bigint; ev bigint; jb bigint; camp bigint; camp2 bigint; dn bigint; dn2 bigint;
  n int; t text; ok boolean;
begin
  select id into ua from auth.users order by created_at limit 1;
  select id into ub from auth.users where id <> ua order by created_at limit 1;
  select id, email into uc, ec from auth.users where id not in (ua, ub) and email is not null order by created_at limit 1;
  select id into ud from auth.users where id not in (ua, ub, uc) order by created_at limit 1;
  if ud is null then raise exception 'SETUP: need four logins'; end if;

  insert into core.organisation (name, kind) values ('Alum Test One', 'college') returning id into a;
  insert into core.organisation (name, kind) values ('Alum Test Two', 'college') returning id into b;
  insert into core.subscription (org_id, product_code, status) values (a, 'alumni', 'active'), (b, 'alumni', 'active');
  insert into core.membership (org_id, user_id, role) values (a, ua, 'owner'), (b, ud, 'owner')
    on conflict (org_id, user_id) do update set role = excluded.role;
  insert into alum.team (org_id, user_id, role) values (a, ub, 'editor');

  -- ------------------------------------------------------------ admin
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if alum.role(a) <> 'admin' then raise exception 'FAIL 1: owner is not alumni admin'; end if;
  perform alum.setup(a);
  perform alum.setup(a);
  select count(*) into n from alum.settings where org_id = a;
  if n <> 1 then raise exception 'FAIL 1: settings rows %', n; end if;
  update alum.settings set reg_80g = 'AAATA1234FF20214', pan = 'AAATA1234F' where org_id = a;
  reset role;

  -- ------------------------------------------------------------ editor adds alumni
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if alum.role(a) <> 'editor' then raise exception 'FAIL 2: editor role wrong'; end if;
  insert into alum.member (org_id, full_name, email, batch_year, programme, status, source)
    values (a, 'Verified Alum', upper(ec), 2015, 'B.Com', 'verified', 'import') returning id into m_c;
  select count(*) into n from alum.member where id = m_c and user_id = uc and email = lower(ec);
  if n <> 1 then raise exception 'FAIL 2: verified record not linked to its login'; end if;
  insert into alum.member (org_id, full_name, batch_year, programme, status, company) values (a, 'Listed Alum', 2016, 'BBA', 'verified', 'Infosys') returning id into m_other;
  insert into alum.member (org_id, full_name, email, batch_year, status, source) values (a, 'Pending Alum', 'pending.alum@example.com', 2020, 'pending', 'self') returning id into m_pending;
  begin
    insert into alum.member (org_id, full_name, email) values (a, 'Duplicate', 'PENDING.ALUM@example.com');
    raise exception 'FAIL 3: duplicate email accepted';
  exception when unique_violation then null;
  end;

  insert into alum.event (org_id, title, starts_at, venue) values (a, 'Annual reunion', now() + interval '20 days', 'Main hall') returning id into ev;
  insert into alum.campaign (org_id, title, goal, fund_type) values (a, 'Library fund', 500000, 'specific') returning id into camp;
  insert into alum.campaign (org_id, title, eligible_80g) values (a, 'Reunion tickets', false) returning id into camp2;
  insert into alum.job (org_id, title, company) values (a, 'Staff job', 'College') returning id into jb;

  -- donations: the 80G rules
  insert into alum.donation (org_id, campaign_id, donor_name, donor_pan, amount, mode, donated_on, member_id)
    values (a, camp, 'Verified Alum', 'abcde1234f', 5000, 'upi', current_date, m_c) returning id into dn;
  select receipt_number into t from alum.donation where id = dn;
  if t <> '80G/' || alum.fy(current_date) || '/0001' then raise exception 'FAIL 4: receipt %', t; end if;
  insert into alum.donation (org_id, campaign_id, donor_name, donor_pan, amount, mode, donated_on)
    values (a, camp, 'Cash Donor', 'ABCDE1234F', 5000, 'cash', current_date) returning id into dn2;
  select eligible_80g, not_eligible_why into ok, t from alum.donation where id = dn2;
  if ok or t not like 'Cash donations above%' then raise exception 'FAIL 5: cash over 2,000 got 80G (%)', t; end if;
  insert into alum.donation (org_id, campaign_id, donor_name, amount, mode, donated_on) values (a, camp, 'No PAN', 1000, 'upi', current_date) returning id into dn2;
  select not_eligible_why into t from alum.donation where id = dn2;
  if t not like '%PAN%' then raise exception 'FAIL 5: missing PAN not caught (%)', t; end if;
  insert into alum.donation (org_id, campaign_id, donor_name, donor_pan, amount, mode, donated_on) values (a, camp2, 'Ticket', 'ABCDE1234F', 1000, 'upi', current_date) returning id into dn2;
  select eligible_80g into ok from alum.donation where id = dn2;
  if ok then raise exception 'FAIL 5: non-80G campaign issued a receipt'; end if;
  begin
    insert into alum.donation (org_id, campaign_id, donor_name, amount, mode, donated_on, donor_citizenship) values (a, camp, 'Foreign', 100, 'bank_transfer', current_date, 'foreign');
    raise exception 'FAIL 6: foreign donation accepted without FCRA';
  exception when raise_exception then
    if sqlerrm not like '%FCRA%' then raise; end if;
  end;
  begin
    update alum.donation set amount = 1 where id = dn;
    raise exception 'FAIL 7: recorded donation edited';
  exception when raise_exception then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
  begin
    delete from alum.donation where id = dn2;
    raise exception 'FAIL 7: donation deleted';
  exception when raise_exception then
    if sqlerrm not like '%never deleted%' then raise; end if;
  end;
  update alum.donation set status = 'cancelled' where id = dn2;
  select count(*) into n from alum.donation where id = dn2 and status = 'cancelled' and cancelled_at is not null;
  if n <> 1 then raise exception 'FAIL 7: cancel did not record'; end if;
  reset role;

  -- the editor cannot change who is on the team
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into alum.team (org_id, user_id, role) values (a, ud, 'admin');
    raise exception 'FAIL 8: editor added an admin';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ------------------------------------------------------------ verified alumnus
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if alum.role(a) <> 'member' then raise exception 'FAIL 9: alumnus role is %', alum.role(a); end if;
  select count(*) into n from alum.member where org_id = a;
  if n <> 2 then raise exception 'FAIL 9: alumnus sees % records (expected the 2 verified)', n; end if;
  select count(*) into n from alum.member where id = m_pending;
  if n <> 0 then raise exception 'FAIL 9: alumnus sees a pending request'; end if;
  update alum.member set city = 'Pune', company = 'TCS' where id = m_c;
  select count(*) into n from alum.member where id = m_c and city = 'Pune';
  if n <> 1 then raise exception 'FAIL 10: alumnus could not edit own profile'; end if;
  begin
    update alum.member set batch_year = 1999 where id = m_c;
    raise exception 'FAIL 10: alumnus changed own batch';
  exception when raise_exception then
    if sqlerrm not like '%alumni office%' then raise; end if;
  end;
  update alum.member set city = 'Hacked' where id = m_other;
  select count(*) into n from alum.member where id = m_other and city = 'Hacked';
  if n <> 0 then raise exception 'FAIL 10: alumnus edited someone else'; end if;
  insert into alum.rsvp (org_id, event_id, member_id, status) values (a, ev, m_c, 'going');
  begin
    insert into alum.rsvp (org_id, event_id, member_id, status) values (a, ev, m_other, 'going');
    raise exception 'FAIL 11: RSVP for someone else';
  exception when insufficient_privilege then null;
  end;
  insert into alum.job (org_id, title, company, member_id) values (a, 'Analyst', 'TCS', m_c);
  begin
    insert into alum.job (org_id, title, company, member_id) values (a, 'Fake', 'X', m_other);
    raise exception 'FAIL 12: job posted as someone else';
  exception when insufficient_privilege then null;
  end;
  update alum.job set title = 'Hijacked' where id = jb;
  select count(*) into n from alum.job where id = jb and title = 'Hijacked';
  if n <> 0 then raise exception 'FAIL 12: alumnus edited a staff job'; end if;
  select count(*) into n from alum.donation where org_id = a;
  if n <> 1 then raise exception 'FAIL 13: alumnus sees % donations (only their own)', n; end if;
  begin
    insert into alum.donation (org_id, campaign_id, donor_name, amount, mode, donated_on) values (a, camp, 'Self', 1, 'upi', current_date);
    raise exception 'FAIL 13: alumnus recorded a donation';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ------------------------------------------------------------ outsiders
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from alum.member where org_id = a;
  if n <> 0 then raise exception 'FAIL 14: other organisation sees % alumni', n; end if;
  select count(*) into n from alum.donation where org_id = a;
  if n <> 0 then raise exception 'FAIL 14: other organisation sees donations'; end if;
  reset role;
  begin
    set local role anon;
    perform 1 from alum.member limit 1;
    raise exception 'FAIL 15: anon can read alumni';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 16. the shared Google sign-in recognises the verified alumnus
  if core.login_for_email(ec) is distinct from uc then raise exception 'FAIL 16: alumnus not recognised for sign-in'; end if;

  -- 17. removing the organisation cascades
  delete from core.organisation where id = a;
  select count(*) into n from alum.donation where org_id = a;
  if n <> 0 then raise exception 'FAIL 17: donations left behind'; end if;

  raise exception 'ALUM_TEST_PASSED';
end $$;
