-- Self-test for 0117 on Greenfield (8). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_staff bigint; h bigint; r bigint; k1 bigint; k2 bigint; it bigint; ok boolean;
begin
  select e.student_id into k1 from public.student_enrollment e where e.school_id = 8 and e.status = 'active' order by e.student_id limit 1;
  select e.student_id into k2 from public.student_enrollment e where e.school_id = 8 and e.status = 'active' and e.student_id <> k1 order by e.student_id limit 1;
  insert into auth.users (id, email, aud, role) values (of, 'qa-hi-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA HI', 'qa-hi-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA HI', 8, v_staff);
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.hostel (name, kind) values ('QA House', 'mixed') returning id into h;
  insert into public.hostel_room (hostel_id, name, beds) values (h, '101', 2) returning id into r;
  insert into public.hostel_allocation (room_id, bed_no, student_id) values (r, 1, k1);
  ok := false; begin insert into public.hostel_allocation (room_id, bed_no, student_id) values (r, 1, k2); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL one bed given twice'; end if;
  ok := false; begin insert into public.hostel_allocation (room_id, bed_no, student_id) values (r, 2, k1); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL one student in two beds'; end if;
  ok := false; begin insert into public.hostel_allocation (room_id, bed_no, student_id) values (r, 3, k2); exception when others then ok := sqlerrm like '%only 2 beds%'; end;
  if not ok then raise exception 'FAIL bed beyond the room'; end if;
  -- moving out frees the bed
  update public.hostel_allocation set to_date = (now() at time zone 'Asia/Kolkata')::date where student_id = k1 and to_date is null;
  insert into public.hostel_allocation (room_id, bed_no, student_id) values (r, 1, k2);
  -- inventory
  insert into public.inventory_item (name, unit, min_stock) values ('QA Chalk box', 'box', 5) returning id into it;
  insert into public.inventory_move (item_id, kind, qty) values (it, 'received', 10);
  insert into public.inventory_move (item_id, kind, qty, person) values (it, 'issued', 4, 'Class VI-A');
  if (select stock from public.inventory_item where id = it) <> 6 then raise exception 'FAIL stock %', (select stock from public.inventory_item where id = it); end if;
  ok := false; begin insert into public.inventory_move (item_id, kind, qty) values (it, 'issued', 7); exception when others then ok := sqlerrm like '%Not enough%'; end;
  if not ok then raise exception 'FAIL stock went below zero'; end if;
  ok := false; begin update public.inventory_item set stock = 100 where id = it; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL stock edited by hand'; end if;
  ok := false; begin delete from public.inventory_move where item_id = it; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL movement deleted'; end if;
  reset role;
end $$;
rollback;
