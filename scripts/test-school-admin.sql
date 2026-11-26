-- Self-test for 0065 (school admin logs). Rolls back.
begin;
do $$
declare v_student bigint; v_n int; a public.audit_log; v_other uuid; v_seen int;
begin
  select id into v_student from public.student where school_id = 8 limit 1;
  update public.student set full_name = full_name || ' QA' where id = v_student;
  select * into a from public.audit_log where school_id = 8 and entity = 'Student' and entity_id = v_student::text order by id desc limit 1;
  if a.id is null or a.action <> 'changed' or not ('full_name' = any(a.fields)) then raise exception 'FAIL: change not logged: %', row_to_json(a); end if;
  if a.actor_name <> 'Eternity or system' then raise exception 'FAIL: system change shown as %', a.actor_name; end if;
  raise notice 'PASS a change is logged with the field that changed, by Eternity or system';

  update public.student set full_name = full_name where id = v_student;
  select count(*) into v_n from public.audit_log where id > a.id and school_id = 8;
  if v_n <> 0 then raise exception 'FAIL: an update that changed nothing was logged'; end if;
  raise notice 'PASS no-op saves are not logged';

  begin
    update public.audit_log set actor_name = 'x' where id = a.id;
    raise exception 'FAIL: the change history could be edited';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS the change history cannot be edited';

  -- an office user of another school sees none of Greenfield's history
  select p.id into v_other from public.profile p join public.staff s on s.id = p.staff_id
   where p.school_id <> 8 and s.role in ('office', 'principal') limit 1;
  if v_other is null then raise notice 'SKIP isolation: no office login at another school'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.audit_log where school_id = 8;
  if v_seen <> 0 then raise exception 'FAIL: another school''s office can read % Greenfield history rows', v_seen; end if;
  select count(*) into v_seen from public.plan_request where school_id = 8;
  if v_seen <> 0 then raise exception 'FAIL: another school can read Greenfield upgrade requests'; end if;
  reset role;
  raise notice 'PASS another school''s office cannot see Greenfield''s history or requests';
end $$;
rollback;
