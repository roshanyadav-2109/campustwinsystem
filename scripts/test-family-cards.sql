begin;
do $$ declare pa uuid := gen_random_uuid(); v_g bigint; v_kid bigint; n int; r jsonb;
begin
  select gs.guardian_id, gs.student_id into v_g, v_kid from public.guardian_student gs join public.id_card k on k.student_id = gs.student_id and k.status = 'active' where gs.school_id = 8 limit 1;
  insert into auth.users (id, email, aud, role) values (pa, 'qa-fc@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA FC', 8, v_g);
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.my_family_cards();
  select card into r from public.my_family_cards() where student_id = v_kid;
  if r -> 'id_card' ->> 'token' is null then raise exception 'FAIL no card for child with an issued card'; end if;
  if n <> (select count(*) from public.guardian_student where guardian_id = v_g) then raise exception 'FAIL % cards for % children', n, (select count(*) from public.guardian_student where guardian_id = v_g); end if;
  if r::text ~ '"aadhaar":' then raise exception 'FAIL full aadhaar exposed'; end if;
  reset role;
end $$;
rollback;
