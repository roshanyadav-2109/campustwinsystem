-- Self-test for 0089 on Greenfield (8) as a temporary office login. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_staff bigint; v_kid bigint; v_year bigint; c1 bigint; t1 text; t2 text; ok boolean; r record;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-idc@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA IDC', 'qa-idc@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA IDC', 8, v_staff);
  select e.student_id, e.academic_year_id into v_kid, v_year from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id
   join public.student s on s.id = e.student_id where e.school_id = 8 and y.is_current and s.status = 'active'
     and not exists (select 1 from public.id_card k where k.student_id = e.student_id and k.status = 'active') limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.id_card (student_id, academic_year_id) values (v_kid, v_year) returning id, verify_token into c1, t1;
  ok := false; begin insert into public.id_card (student_id, academic_year_id) values (v_kid, v_year); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL two active cards for one student'; end if;
  update public.id_card set prints = prints + 1 where id = c1;
  reset role;
  set local role anon;
  select * into r from public.verify_id_card(t1);
  if not r.valid or r.class_label is null then raise exception 'FAIL fresh card not valid: %', r; end if;
  reset role;
  -- card lost: revoke, issue a new one
  set local role authenticated;
  update public.id_card set status = 'revoked', revoke_reason = 'lost' where id = c1;
  insert into public.id_card (student_id, academic_year_id) values (v_kid, v_year) returning verify_token into t2;
  ok := false; begin update public.id_card set status = 'active' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL revoked card restored'; end if;
  reset role;
  set local role anon;
  if (select valid from public.verify_id_card(t1)) then raise exception 'FAIL lost card still valid'; end if;
  if not (select valid from public.verify_id_card(t2)) then raise exception 'FAIL new card not valid'; end if;
  reset role;
  -- the student leaves: the card is no longer valid
  update public.student set status = 'transferred' where id = v_kid;
  set local role anon;
  select * into r from public.verify_id_card(t2);
  if r.valid or position('left' in r.reason) = 0 then raise exception 'FAIL card valid after leaving: %', r; end if;
  reset role;
end $$;
rollback;
