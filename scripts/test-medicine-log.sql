-- Self-test for 0189 on Greenfield (8): a medicine added with consent, due today, a dose recorded and the family told. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_off bigint; k bigint; v_med bigint; ok boolean; v_t time := '10:30';
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-med@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-med@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 8, v_off);
  select e.student_id into k from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current
    where e.school_id = 8 and e.status = 'active' and exists (select 1 from public.guardian_student gs where gs.student_id = e.student_id) limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.add_medicine(k, 'QA Syrup', '5 ml', array[v_t], current_date, current_date + 2, null, null, false); exception when others then ok := sqlerrm like '%consent%'; end;
  if not ok then raise exception 'FAIL added without consent'; end if;
  v_med := public.add_medicine(k, 'QA Syrup', '5 ml', array[v_t], (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date + 2, 'After lunch', 'Dr QA', true);
  if not exists (select 1 from public.medicine_due() x where x.medicine_id = v_med and x.due_at = v_t and x.status is null) then raise exception 'FAIL not due today'; end if;
  perform public.record_dose(v_med, v_t, 'given', 'QA');
  if (select status from public.medicine_due() x where x.medicine_id = v_med) <> 'given' then raise exception 'FAIL dose not recorded'; end if;
  ok := false; begin perform public.record_dose(v_med, '23:59', 'given'); exception when others then ok := sqlerrm like '%not due%'; end;
  if not ok then raise exception 'FAIL a dose at another time accepted'; end if;
  reset role;
  if not exists (select 1 from public.notification where student_id = k and title = 'Medicine at school' and created_at > now() - interval '1 minute') then raise exception 'FAIL family not told'; end if;
end $$;
rollback;
