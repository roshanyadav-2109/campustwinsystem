-- Eternity Core self-test. Runs inside one transaction and always ends by
-- raising an exception, so nothing it creates is ever kept. Success is the
-- message 'CORE_TEST_PASSED'; any other error names the failed check.
-- Run: SUPABASE_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-sql.mjs scripts/test-core.sql
do $$
declare
  v_uni bigint; v_campus bigint; v_solo bigint;
  v_uni_org uuid; v_campus_org uuid; v_solo_org uuid;
  v_profile uuid; v_n int; v_txt text;
begin
  -- 1. new university gets an organisation and a CampusTwin subscription
  insert into public.university (name, slug, status) values ('Core Test University', 'core-test-uni', 'active')
    returning id, org_id into v_uni, v_uni_org;
  if v_uni_org is null then raise exception 'FAIL 1: university got no organisation'; end if;
  select count(*) into v_n from core.subscription where org_id = v_uni_org and product_code = 'campustwin' and status = 'active';
  if v_n <> 1 then raise exception 'FAIL 1: university subscription count %', v_n; end if;

  -- 2. a campus joins its university's organisation, no new organisation
  insert into public.school (name, code, slug, university_id, status) values ('Core Test Campus', 'CTC', 'core-test-campus', v_uni, 'active')
    returning id, org_id into v_campus, v_campus_org;
  if v_campus_org is distinct from v_uni_org then raise exception 'FAIL 2: campus not in university organisation'; end if;
  select count(*) into v_n from core.organisation where slug = 'core-test-campus';
  if v_n <> 0 then raise exception 'FAIL 2: campus created its own organisation'; end if;

  -- 3. standalone school gets its own organisation and subscription
  insert into public.school (name, code, slug, status) values ('Core Test School', 'CTS', 'core-test-school', 'active')
    returning id, org_id into v_solo, v_solo_org;
  if v_solo_org is null or v_solo_org = v_uni_org then raise exception 'FAIL 3: standalone school organisation wrong'; end if;
  select count(*) into v_n from core.subscription where org_id = v_solo_org and status = 'active';
  if v_n <> 1 then raise exception 'FAIL 3: standalone subscription count %', v_n; end if;

  -- 4. renaming and suspending the school follows into its organisation
  update public.school set name = 'Core Test School Renamed', status = 'suspended' where id = v_solo;
  select name || '|' || status into v_txt from core.organisation where id = v_solo_org;
  if v_txt <> 'Core Test School Renamed|suspended' then raise exception 'FAIL 4: organisation not synced: %', v_txt; end if;

  -- 5. renaming a campus must not rename the university organisation
  update public.school set name = 'Core Test Campus Renamed' where id = v_campus;
  select name into v_txt from core.organisation where id = v_uni_org;
  if v_txt <> 'Core Test University' then raise exception 'FAIL 5: campus rename leaked to university: %', v_txt; end if;

  -- 6. moving an existing login to the new school makes them a member with CampusTwin access
  select id into v_profile from public.profile order by created_at limit 1;
  update public.profile set school_id = v_solo, university_id = null where id = v_profile;
  select count(*) into v_n from core.membership m join core.product_access a on a.membership_id = m.id
   where m.org_id = v_solo_org and m.user_id = v_profile and a.product_code = 'campustwin';
  if v_n <> 1 then raise exception 'FAIL 6: membership not created (%)', v_n; end if;

  -- 7. a second live subscription for the same product is refused
  begin
    insert into core.subscription (org_id, product_code, status) values (v_solo_org, 'campustwin', 'trial');
    raise exception 'FAIL 7: duplicate live subscription accepted';
  exception when unique_violation then null;
  end;

  -- 8. the audit log refuses changes
  insert into core.audit_event (org_id, action) values (v_solo_org, 'test.event');
  begin
    update core.audit_event set action = 'test.changed' where org_id = v_solo_org;
    raise exception 'FAIL 8: audit event was updated';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  -- 9. signed-in users and the public cannot read core
  begin
    set local role authenticated;
    perform 1 from core.organisation limit 1;
    raise exception 'FAIL 9: authenticated can read core';
  exception when insufficient_privilege then null;
  end;
  reset role;
  begin
    set local role anon;
    perform 1 from core.subscription limit 1;
    raise exception 'FAIL 9: anon can read core';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 10. the server role can read core
  set local role service_role;
  select count(*) into v_n from core.organisation;
  reset role;
  if v_n < 1 then raise exception 'FAIL 10: service role sees no organisations'; end if;

  -- 11. deleting a standalone school that only had CampusTwin removes its organisation
  declare v_s2 bigint; v_o2 uuid;
  begin
    insert into public.school (name, code, slug, status) values ('Core Test Two', 'CT2', 'core-test-two', 'active')
      returning id, org_id into v_s2, v_o2;
    delete from public.school where id = v_s2;
    select count(*) into v_n from core.organisation where id = v_o2;
    if v_n <> 0 then raise exception 'FAIL 11: organisation left after school deleted'; end if;
  end;

  -- 12. a customer that also has another product survives; only CampusTwin is cancelled
  declare v_s3 bigint; v_o3 uuid;
  begin
    insert into public.school (name, code, slug, status) values ('Core Test Three', 'CT3', 'core-test-three', 'active')
      returning id, org_id into v_s3, v_o3;
    insert into core.subscription (org_id, product_code, status) values (v_o3, 'hr', 'active');
    delete from public.school where id = v_s3;
    select count(*) into v_n from core.organisation where id = v_o3;
    if v_n <> 1 then raise exception 'FAIL 12: customer with HR was deleted'; end if;
    select status into v_txt from core.subscription where org_id = v_o3 and product_code = 'campustwin';
    if v_txt <> 'cancelled' then raise exception 'FAIL 12: CampusTwin subscription is %', v_txt; end if;
  end;

  -- 13. deleting one campus keeps the university's organisation
  delete from public.school where id = v_campus;
  select count(*) into v_n from core.organisation where id = v_uni_org;
  if v_n <> 1 then raise exception 'FAIL 13: university organisation removed with a campus'; end if;

  -- 14. a school whose organisation has audit events can still be deleted; the events stay
  declare v_s4 bigint; v_o4 uuid; v_ev bigint;
  begin
    insert into public.school (name, code, slug, status) values ('Core Test Four', 'CT4', 'core-test-four', 'active')
      returning id, org_id into v_s4, v_o4;
    insert into core.audit_event (org_id, action) values (v_o4, 'test.kept') returning id into v_ev;
    delete from public.school where id = v_s4;
    select count(*) into v_n from core.audit_event where id = v_ev and org_id is null;
    if v_n <> 1 then raise exception 'FAIL 14: audit event lost or still linked'; end if;
  end;

  -- 15. reserved addresses cannot be taken by a school or university
  begin
    insert into public.school (name, code, slug, status) values ('Grab HR', 'GHR', 'hrms', 'active');
    raise exception 'FAIL 15: school took a reserved address';
  exception when check_violation then null;
  end;
  begin
    insert into public.university (name, slug, status) values ('Grab Finance', 'finance', 'active');
    raise exception 'FAIL 15: university took a reserved address';
  exception when check_violation then null;
  end;

  raise exception 'CORE_TEST_PASSED';
end $$;
