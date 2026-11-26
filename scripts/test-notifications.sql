-- Self-test for 0091 on Greenfield (8). Temporary parent and office logins act
-- through their own rules. Rolled back.
begin;
do $$ declare pa uuid := gen_random_uuid(); of uuid := gen_random_uuid(); v_g bigint; v_g2 bigint; v_kid bigint; v_staff bigint;
  n bigint; n2 bigint; c int; ok boolean; r record;
begin
  select gs.guardian_id, gs.student_id into v_g, v_kid from public.guardian_student gs where gs.school_id = 8 limit 1;
  select g.id into v_g2 from public.guardian g where g.school_id = 8 and g.id <> v_g limit 1;
  update public.guardian set email = 'qa-parent-ntf@example.com', phone = '9800000001' where id = v_g;
  insert into auth.users (id, email, aud, role) values (pa, 'qa-parent-ntf@example.com', 'authenticated', 'authenticated'), (of, 'qa-office-ntf@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA Parent', 8, v_g);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-office-ntf@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 8, v_staff);

  -- the office switches on email (log) and SMS (generic http) and stores SMS keys in Vault
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.notification_setting (channel, provider, config) values ('email', 'log', '{}'), ('sms', 'http', '{"url":"https://sms.example/send"}');
  perform public.set_notification_secret('sms', '{"api_key":"QA-SECRET"}');
  reset role;

  -- an event
  n := public.notify(8, 'qa_event', 'qa:1', v_g, null, v_kid, '{"name":"Asha","date":"27/11"}', 'Hello {name}', '{name} was absent on {date}.');
  if n is null then raise exception 'FAIL no inbox message'; end if;
  if (select body from public.notification where id = n) <> 'Asha was absent on 27/11.' then raise exception 'FAIL template not rendered: %', (select body from public.notification where id = n); end if;
  select count(*) into c from public.notification_delivery where notification_id = n;
  if c <> 2 then raise exception 'FAIL deliveries %', c; end if;
  -- the same event again sends nothing
  n2 := public.notify(8, 'qa_event', 'qa:1', v_g, null, v_kid, '{}', 'x', 'y');
  if n2 is not null or (select count(*) from public.notification where dedupe_key = 'qa:1') <> 1 then raise exception 'FAIL duplicate sent'; end if;

  -- log provider completes in the database
  perform public.complete_log_deliveries();
  if (select status from public.notification_delivery where notification_id = n and channel = 'email') <> 'sent' then raise exception 'FAIL log email not sent'; end if;
  -- the dispatcher gets the SMS with its config and secret; failures retry then stop
  select * into r from public.take_deliveries(10) where channel = 'sms';
  if r.id is null or r.secret <> '{"api_key":"QA-SECRET"}' or r.config ->> 'url' <> 'https://sms.example/send' then raise exception 'FAIL take_deliveries %', r; end if;
  perform public.delivery_result(r.id, false, null, 'timeout');
  if (select status from public.notification_delivery where id = r.id) <> 'queued' then raise exception 'FAIL no retry'; end if;
  update public.notification_delivery set attempts = 3, status = 'sending' where id = r.id;
  perform public.delivery_result(r.id, false, null, 'timeout');
  if (select status from public.notification_delivery where id = r.id) <> 'failed' then raise exception 'FAIL not failed after 3 attempts'; end if;

  -- the parent sees their own inbox; cannot see secrets, other parents, or send
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from public.my_notifications(50) where id = n; if c <> 1 then raise exception 'FAIL parent inbox'; end if;
  select count(*) into c from public.notification; if c <> 0 then raise exception 'FAIL parent reads notification table directly'; end if;
  select count(*) into c from public.notification_setting; if c <> 0 then raise exception 'FAIL parent reads settings'; end if;
  if public.mark_notifications_read(array[n]) <> 1 then raise exception 'FAIL mark read'; end if;
  ok := false; begin perform public.take_deliveries(1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent could take deliveries'; end if;
  ok := false; begin perform public.notify(8, 'x', 'x', v_g2, null, null, '{}', 'x', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent could send messages'; end if;
  ok := false; begin perform public.set_notification_secret('sms', 'steal'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent could change keys'; end if;
  reset role;
end $$;
rollback;
