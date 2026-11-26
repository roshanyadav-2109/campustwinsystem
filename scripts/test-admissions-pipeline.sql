-- Self-test for 0112 on Greenfield (8). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_staff bigint; v_year bigint; v_class bigint; e1 bigint; e2 bigint; e3 bigint; sl bigint; ok boolean; r record; n int;
begin
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select id into v_class from public.class where school_id = 8 order by level desc limit 1;
  insert into auth.users (id, email, aud, role) values (of, 'qa-adm-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Adm', 'qa-adm-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Adm', 8, v_staff);
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- seats: as many as are already taken + 1
  select count(*) into n from public.admission_enquiry e where e.class_id = v_class and e.academic_year_id = v_year and (e.status = 'admitted' or e.seat_claimed_at is not null);
  insert into public.admission_seat (academic_year_id, class_id, seats) values (v_year, v_class, n + 1);
  insert into public.admission_enquiry (child_name, guardian_name, phone, class_id, academic_year_id, source, status, score, school_id) values ('QA Child One', 'QA P1', '9800000101', v_class, v_year, 'walk_in', 'applied', 70, 8) returning id into e1;
  insert into public.admission_enquiry (child_name, guardian_name, phone, class_id, academic_year_id, source, status, score, school_id) values ('QA Child Two', 'QA P2', '9800000102', v_class, v_year, 'walk_in', 'applied', 90, 8) returning id into e2;
  insert into public.admission_enquiry (child_name, guardian_name, phone, class_id, academic_year_id, source, status, score, school_id) values ('QA Child Three', 'QA P3', '9800000103', v_class, v_year, 'walk_in', 'applied', 70, 8) returning id into e3;
  -- merit: higher score first; equal scores: earlier enquiry first
  select * into r from public.admission_merit(v_year, v_class) where enquiry_id = e2;
  if r.rank <> 1 or not r.within_seats then raise exception 'FAIL merit top: %', r; end if;
  if (select rank from public.admission_merit(v_year, v_class) where enquiry_id = e1) > (select rank from public.admission_merit(v_year, v_class) where enquiry_id = e3) then raise exception 'FAIL tie-break by enquiry order'; end if;
  if (select within_seats from public.admission_merit(v_year, v_class) where enquiry_id = e1) then raise exception 'FAIL only one seat left but two within seats'; end if;
  -- the last seat once
  perform public.claim_admission_seat(e2);
  ok := false; begin perform public.claim_admission_seat(e1); exception when others then ok := sqlerrm like 'All % seats%'; end;
  if not ok then raise exception 'FAIL seat over the limit'; end if;
  perform public.release_admission_seat(e2);
  perform public.claim_admission_seat(e1);
  -- slots: capacity
  insert into public.admission_slot (academic_year_id, class_id, kind, starts_at, capacity) values (v_year, v_class, 'test', now() + interval '3 days', 2) returning id into sl;
  insert into public.admission_booking (slot_id, enquiry_id, kind) values (sl, e1, 'test'), (sl, e2, 'test');
  ok := false; begin insert into public.admission_booking (slot_id, enquiry_id, kind) values (sl, e3, 'test'); exception when others then ok := sqlerrm like '%full%'; end;
  if not ok then raise exception 'FAIL slot over capacity'; end if;
  ok := false; begin insert into public.admission_booking (slot_id, enquiry_id, kind) values (sl, e1, 'test'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL booked twice'; end if;
  -- documents
  insert into public.admission_document (enquiry_id, kind, file_key) values (e1, 'Birth certificate', 'x/admissions/1/doc.pdf');
  reset role;
end $$;
rollback;
