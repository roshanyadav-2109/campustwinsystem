-- An office login may run late fees only for its own school. Rolled back.
begin;
do $$ declare v_office uuid := gen_random_uuid(); ok int := 0; begin
  insert into auth.users (id, email, aud, role) values (v_office, 'qa-guard@example.com', 'authenticated', 'authenticated');
  with st as (insert into public.staff (school_id, full_name, email, role) values (8, 'QA Guard', 'qa-guard@example.com', 'office') returning id)
  insert into public.profile (id, role, full_name, school_id, staff_id) select v_office, 'staff', 'QA Guard', 8, id from st;
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.apply_late_fees(null); exception when others then ok := ok + 1; end;
  begin perform public.apply_late_fees(9); exception when others then ok := ok + 1; end;
  perform public.apply_late_fees(8);
  reset role;
  if ok <> 2 then raise exception 'FAIL guard let % of 2 through', 2 - ok; end if;
end $$;
rollback;
