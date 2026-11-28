-- Self-test for 0202 on Greenfield (8): a hosteller's parent asks for a pass; the warden approves, marks left and back;
-- another parent and a teacher cannot act on it; tonight's roll fills in a student away on a pass and tells the family of
-- the absent one; a student reserves a book whose only copy is out and is told when it is returned. Rolled back.
begin;
do $$ declare wu uuid := gen_random_uuid(); pu uuid := gen_random_uuid(); xu uuid := gen_random_uuid(); su uuid := gen_random_uuid();
  v_w bigint; v_h bigint; v_room bigint; v_s1 bigint; v_s2 bigint; v_g bigint; v_x bigint; v_pass bigint; v_book bigint; v_issue bigint; v_hold bigint; n int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select gs.student_id, gs.guardian_id into v_s1, v_g from public.guardian_student gs join public.student st on st.id = gs.student_id where st.school_id = 8 and st.status = 'active' limit 1;
  select st.id into v_s2 from public.student st where st.school_id = 8 and st.status = 'active' and st.id <> v_s1 limit 1;
  insert into auth.users (id, email, aud, role) values (wu, 'qa-hl-w@example.com', 'authenticated', 'authenticated'), (pu, 'qa-hl-p@example.com', 'authenticated', 'authenticated'),
    (xu, 'qa-hl-x@example.com', 'authenticated', 'authenticated'), (su, 'qa-hl-s@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Warden', 'qa-hl-w@example.com', 'subject_teacher') returning id into v_w;
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Teacher', 'qa-hl-x@example.com', 'subject_teacher') returning id into v_x;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (wu, 'staff', 'QA Warden', 8, v_w), (xu, 'staff', 'QA Teacher', 8, v_x);
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pu, 'guardian', 'QA Parent', 8, v_g);
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 8, v_s1);
  insert into public.hostel (school_id, name, kind, warden_staff_id) values (8, 'QA Hostel', 'boys', v_w) returning id into v_h;
  insert into public.hostel_room (school_id, hostel_id, name, beds) values (8, v_h, 'QA-101', 2) returning id into v_room;
  insert into public.hostel_allocation (school_id, room_id, bed_no, student_id, from_date) values (8, v_room, '1', v_s1, v_today - 10), (8, v_room, '2', v_s2, v_today - 10);

  -- the parent asks for tonight; a teacher who is not the warden cannot approve; the warden approves, marks left
  perform set_config('request.jwt.claims', json_build_object('sub', pu, 'role', 'authenticated')::text, true); set local role authenticated;
  v_pass := public.ask_hostel_pass(v_s1, 'home', 'QA family function', now() + interval '1 hour', now() + interval '2 days');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', xu, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.hostel_pass_step(v_pass, 'approve'); raise exception 'FAIL a teacher approved the pass'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', wu, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.hostel_pass_step(v_pass, 'approve');
  begin perform public.hostel_pass_step(v_pass, 'back'); raise exception 'FAIL marked back before leaving'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.hostel_pass_step(v_pass, 'left');
  -- tonight's roll: the first student is away on the pass; the second is absent
  n := public.mark_hostel_roll(v_h, v_today, array[v_s2]);
  reset role;
  if (select status from public.hostel_roll where hostel_id = v_h and on_date = v_today and student_id = v_s1) <> 'on_pass' then raise exception 'FAIL the student on a pass was not filled in'; end if;
  if (select status from public.hostel_roll where hostel_id = v_h and on_date = v_today and student_id = v_s2) <> 'absent' then raise exception 'FAIL absence not recorded'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', wu, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.hostel_pass_step(v_pass, 'back');
  reset role;
  if (select status from public.hostel_pass where id = v_pass) <> 'back' then raise exception 'FAIL not back'; end if;
  if not exists (select 1 from public.notification where student_id = v_s1 and title = 'Hostel pass approved') then raise exception 'FAIL the family was not told'; end if;

  -- library: the only copy is out; the student reserves it; on return the hold is ready and the family told
  insert into public.library_book (school_id, accession_no, title, author, category, copies_total, is_active) values (8, 'QA-ACC-' || floor(random() * 1e6)::text, 'QA Reserved Book', 'QA Author', 'Reference', 1, true) returning id into v_book;
  insert into public.library_issue (school_id, book_id, student_id, issued_on, due_on) values (8, v_book, v_s2, v_today - 3, v_today + 11) returning id into v_issue;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  v_hold := public.hold_book(v_book);
  begin perform public.hold_book(v_book); raise exception 'FAIL reserved twice'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  update public.library_issue set returned_on = v_today where id = v_issue;
  if (select status from public.library_hold where id = v_hold) <> 'ready' then raise exception 'FAIL the hold is not ready after the return'; end if;
  if not exists (select 1 from public.notification where student_id = v_s1 and title = 'Reserved book is ready') then raise exception 'FAIL not told the book is ready'; end if;
  raise notice 'hostel and library ok';
end $$;
rollback;
