-- Self-test for 0075 on Greenfield (8), with temporary parent and office logins
-- acting through their own row rules. Rolled back.
begin;
do $$ declare v_parent uuid := gen_random_uuid(); v_office uuid := gen_random_uuid(); v_child bigint; v_other bigint; n int; ok boolean;
begin
  select gs.student_id into v_child from public.guardian_student gs where gs.school_id = 8 limit 1;
  select e.student_id into v_other from public.student_enrollment e join public.section s on s.id = e.section_id
   where s.school_id = 8 and e.student_id not in (select gs2.student_id from public.guardian_student gs1 join public.guardian_student gs2 on gs2.guardian_id = gs1.guardian_id where gs1.student_id = v_child) limit 1;
  insert into auth.users (id, email, aud, role) values (v_parent, 'qa-p-prof@example.com', 'authenticated', 'authenticated'), (v_office, 'qa-o-prof@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) select v_parent, 'guardian', 'QA Parent', 8, gs.guardian_id from public.guardian_student gs where gs.student_id = v_child limit 1;
  with st as (insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-o-prof@example.com', 'office') returning id)
  insert into public.profile (id, role, full_name, school_id, staff_id) select v_office, 'staff', 'QA Office', 8, id from st;

  -- office saves both parts for two students
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.student_profile (student_id, blood_group, emergency_name, emergency_phone, pincode) values (v_child, 'B+', 'QA Uncle', '9876543210', '411001'), (v_other, 'O+', 'QA Aunt', '9876500000', '411002');
  insert into public.student_identity (student_id, apaar_id, pen, aadhaar_last4, category) values (v_child, '123456789012', '12345678901', '4321', 'obc'), (v_other, '123456789013', null, null, 'general');
  if (select school_id from public.student_profile where student_id = v_child) <> 8 then raise exception 'FAIL school not set'; end if;
  ok := false; begin insert into public.student_identity (student_id, aadhaar_last4) values (v_child, '123456789012'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL a full Aadhaar number was accepted'; end if;
  reset role;

  -- the parent sees their child's profile, not another child's, and no identity row at all
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.student_profile where student_id = v_child; if n <> 1 then raise exception 'FAIL parent cannot see own child profile'; end if;
  select count(*) into n from public.student_profile where student_id = v_other; if n <> 0 then raise exception 'FAIL parent sees another child'; end if;
  select count(*) into n from public.student_identity; if n <> 0 then raise exception 'FAIL parent sees identity details'; end if;
  update public.student_profile set blood_group = 'A+' where student_id = v_child;
  reset role;
  if (select blood_group from public.student_profile where student_id = v_child) <> 'B+' then raise exception 'FAIL parent changed the profile'; end if;
end $$;
rollback;
