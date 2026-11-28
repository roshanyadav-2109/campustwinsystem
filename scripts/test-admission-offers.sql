-- Self-test for 0177 on Greenfield (8): offers, waiting list, lapse, application fee online. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_off bigint; v_year bigint; v_class bigint; a bigint; b bigint; c bigint; ta text; tb text; v_no text; ok boolean; r record; v_pub text; v_gw bigint;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-ao@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-ao@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 8, v_off);
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select id into v_class from public.class where school_id = 8 order by level desc limit 1;
  -- a class with exactly as many seats as are taken now, plus one
  insert into public.admission_seat (school_id, academic_year_id, class_id, seats) values (8, v_year, v_class, public.admission_taken(v_year, v_class) + 1)
    on conflict (academic_year_id, class_id) do update set seats = excluded.seats;
  insert into public.admission_enquiry (school_id, child_name, class_id, guardian_name, phone, source, status, academic_year_id, score)
  values (8, 'QA Child A', v_class, 'QA Parent', '9000000001', 'online', 'applied', v_year, 80) returning id, public_token into a, ta;
  insert into public.admission_enquiry (school_id, child_name, class_id, guardian_name, phone, source, status, academic_year_id, score)
  values (8, 'QA Child B', v_class, 'QA Parent', '9000000002', 'online', 'applied', v_year, 70) returning id, public_token into b, tb;
  insert into public.admission_enquiry (school_id, child_name, class_id, guardian_name, phone, source, status, academic_year_id, score)
  values (8, 'QA Child C', v_class, 'QA Parent', '9000000003', 'online', 'applied', v_year, 90) returning id into c;
  update public.school set application_fee = 500, offer_days = 5, auto_waitlist = true where id = 8;

  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  v_no := public.make_offer(a);
  if v_no not like 'OF-%' then raise exception 'FAIL offer number %', v_no; end if;
  -- the class is now full: a second offer is refused, the waiting list takes it
  ok := false; begin perform public.make_offer(b); exception when others then ok := sqlerrm like '%waiting list%'; end;
  if not ok then raise exception 'FAIL offer beyond seats'; end if;
  perform public.waitlist_application(b);
  perform public.waitlist_application(c);
  reset role;
  -- C scored higher, so C is first in line
  if (select waitlist_position from public.applicant_status(tb)) <> 2 then raise exception 'FAIL waitlist position of B: %', (select waitlist_position from public.applicant_status(tb)); end if;
  -- the family declines through its link (no login): the seat goes to C automatically
  set local role anon;
  if public.respond_offer(ta, false) <> 'declined' then raise exception 'FAIL decline'; end if;
  reset role;
  if (select status from public.admission_enquiry where id = c) <> 'offered' then raise exception 'FAIL waitlist not promoted'; end if;
  if (select offer_expires_on from public.admission_enquiry where id = c) <> (now() at time zone 'Asia/Kolkata')::date + 5 then raise exception 'FAIL offer days'; end if;
  -- C's offer lapses: B gets it
  update public.admission_enquiry set offer_expires_on = (now() at time zone 'Asia/Kolkata')::date - 1 where id = c;
  perform public.expire_admission_offers();
  if (select status from public.admission_enquiry where id = c) <> 'declined' or (select status from public.admission_enquiry where id = b) <> 'offered' then raise exception 'FAIL lapse'; end if;
  -- families were told (the messages are on record)
  if (select count(*) from public.notification where enquiry_id in (a, b, c)) < 4 then raise exception 'FAIL messages %', (select count(*) from public.notification where enquiry_id in (a, b, c)); end if;
  -- B accepts
  set local role anon;
  perform public.respond_offer(tb, true);
  reset role;
  if (select status from public.admission_enquiry where id = b) <> 'accepted' then raise exception 'FAIL accept'; end if;
  -- the application fee online (test gateway at a sample school)
  select id into v_gw from public.payment_gateway where school_id = 8 and active;
  if v_gw is null then
    insert into public.payment_gateway (school_id, provider, label, mode, active) values (8, 'test', 'QA test', 'test', true) returning id into v_gw;
  end if;
  set local role anon;
  select * into r from public.create_application_payment(tb);
  reset role;
  if r.amount <> 500 then raise exception 'FAIL fee amount %', r.amount; end if;
  perform public.complete_payment_order(r.order_public_id, 'test_qa', 500);
  if (select app_fee_paid_on from public.admission_enquiry where id = b) is null then raise exception 'FAIL fee not recorded'; end if;
  set local role anon;
  if not (select fee_paid from public.applicant_status(tb)) then raise exception 'FAIL status page fee'; end if;
  ok := false; begin perform public.create_application_payment(tb); exception when others then ok := sqlerrm like '%already paid%'; end;
  if not ok then raise exception 'FAIL pay twice'; end if;
  -- a made-up link shows nothing
  if exists (select 1 from public.applicant_status(repeat('a', 32))) then raise exception 'FAIL bad link'; end if;
  reset role;
end $$;
rollback;
