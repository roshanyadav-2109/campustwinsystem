-- Self-test for 0059 (alumni directory privacy). Runs inside a transaction and
-- rolls back. Uses the fictional Greenfield sample organisation.
begin;
do $$
declare
  v_org uuid := 'b6642535-9023-42ea-971f-478fc0aafe0c';
  v_user uuid;
  v_others int;
  v_dir int;
  v_contact int;
begin
  -- a verified alumnus with a login, acting as themselves
  select user_id into v_user from alum.member
   where org_id = v_org and status = 'verified' and user_id is not null
     and not alum.is_staff(org_id) limit 1;
  if v_user is null then raise exception 'SKIP: no verified alumnus with a login in the sample'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_others from alum.member where org_id = v_org and user_id is distinct from v_user;
  if v_others <> 0 then raise exception 'FAIL: alumnus can read % other full records', v_others; end if;
  raise notice 'PASS alumnus cannot read other alumni''s full records (email, phone)';

  select count(*) into v_dir from alum.directory(v_org);
  if v_dir = 0 then raise exception 'FAIL: directory returned nobody'; end if;
  raise notice 'PASS directory still lists % alumni', v_dir;

  select count(*) into v_contact from alum.member where org_id = v_org and user_id = v_user;
  if v_contact <> 1 then raise exception 'FAIL: alumnus cannot read own record'; end if;
  raise notice 'PASS alumnus can read own record';

  select count(*) into v_dir from alum.directory(v_org, '%');
  if v_dir <> 0 then raise exception 'FAIL: a %% search matched everyone (% rows)', v_dir; end if;
  raise notice 'PASS search text is literal';

  reset role;
end $$;
rollback;
