-- SECURITY regression test: a parent must not be able to turn their own
-- login into the office by editing their profile row. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_g bigint; v_office bigint; before_ok boolean; after_ok boolean; err text;
begin
  select gs.guardian_id into v_g from public.guardian_student gs where gs.school_id = 8 limit 1;
  select s.id into v_office from public.staff s where s.school_id = 8 and s.role = 'office' and not exists (select 1 from public.profile p where p.staff_id = s.id) limit 1;
  insert into auth.users (id, email, aud, role) values (u, 'qa-esc@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (u, 'guardian', 'QA Parent', 8, v_g);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  before_ok := app.is_office();
  begin
    update public.profile set role = 'staff', staff_id = v_office, guardian_id = null where id = u;
  exception when others then err := sqlerrm; end;
  after_ok := app.is_office();
  reset role;
  if after_ok or err is null then raise exception 'FAIL a parent made themselves office (error: %)', coalesce(err, 'none'); end if;
  -- their own language can still be changed
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profile set locale = 'hi' where id = u;
  reset role;
  if (select locale from public.profile where id = u) <> 'hi' then raise exception 'FAIL language can no longer be changed'; end if;
end $$;
rollback;
