-- Self-test for 0196 on Greenfield (8): the gateway application keeps PAN and bank account in the vault (last four
-- digits only readable); the public policy details carry nothing private; users cannot read the keys; Razorpay can't
-- be switched on without its key id; a teacher can't change payment settings. Rolled back.
begin;
do $$ declare ou uuid := gen_random_uuid(); tu uuid := gen_random_uuid(); v_of bigint; v_t bigint; v_gw bigint; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (ou, 'qa-gs-o@example.com', 'authenticated', 'authenticated'), (tu, 'qa-gs-t@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-gs-o@example.com', 'office') returning id into v_of;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (ou, 'staff', 'QA Office', 8, v_of);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Teacher', 'qa-gs-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (tu, 'staff', 'QA Teacher', 8, v_t);
  delete from public.payment_gateway where school_id = 8 and provider = 'razorpay' and mode = 'test';
  insert into public.payment_gateway (school_id, provider, mode) values (8, 'razorpay', 'test') returning id into v_gw;

  -- the office fills the application
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.save_payment_profile('{}'::jsonb, 'NOTAPAN', null); raise exception 'FAIL a bad PAN was accepted'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.save_payment_profile(jsonb_build_object('legal_name', 'QA Education Trust', 'entity_type', 'trust', 'bank_ifsc', 'HDFC0001234', 'refund_days', '10', 'contact_email', 'office@example.com'), 'ABCDE1234F', '123456789012');
  if (select pan_last4 || '/' || bank_last4 from public.payment_profile where school_id = 8) <> '234F/9012' then raise exception 'FAIL last four digits not kept'; end if;
  begin perform (select secret_id from public.payment_profile where school_id = 8); raise exception 'FAIL the vault reference is readable'; exception when insufficient_privilege then null; end;
  begin perform public.payment_gateway_keys(v_gw, 8); raise exception 'FAIL a user can read gateway keys'; exception when insufficient_privilege then null; end;
  -- Razorpay needs its key id before it can be switched on
  perform public.set_payment_gateway_secret(v_gw, '{"key_secret":"qa_secret_123","webhook_secret":"qa_hook"}');
  ok := true;
  begin perform public.set_active_gateway(v_gw, array['test', 'razorpay']); ok := false; exception when others then null; end;
  if not ok then raise exception 'FAIL switched on without a key id'; end if;
  perform public.set_payment_gateway_config(v_gw, '{"key_id":"rzp_test_QA12345678"}');
  reset role;
  if (select config ->> 'key_id' from public.payment_gateway where id = v_gw) <> 'rzp_test_QA12345678' then raise exception 'FAIL key id not saved'; end if;
  -- the secrets are in the vault, as saved
  if (select (k.secret::jsonb ->> 'key_secret') from public.payment_gateway_keys(v_gw, 8) k) <> 'qa_secret_123' then raise exception 'FAIL gateway secret not readable by the server'; end if;
  if (select ds.decrypted_secret::jsonb ->> 'pan' from vault.decrypted_secrets ds join public.payment_profile pp on pp.secret_id = ds.id where pp.school_id = 8) <> 'ABCDE1234F' then raise exception 'FAIL PAN not in the vault'; end if;
  -- the public policy details: the trust's name and the refund days, nothing private
  if (select legal_name || ':' || refund_days from public.policy_details(8)) <> 'QA Education Trust:10' then raise exception 'FAIL policy details'; end if;
  if exists (select 1 from public.policy_details(8) d where to_jsonb(d)::text ~ '(ABCDE|123456789012|234F)') then raise exception 'FAIL private details in the policy pages'; end if;
  -- a teacher cannot change payment settings
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.save_payment_profile('{"legal_name":"X"}'::jsonb, null, null); raise exception 'FAIL a teacher changed the application'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_payment_gateway_secret(v_gw, '{}'); raise exception 'FAIL a teacher changed the keys'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  raise notice 'gateway setup ok';
end $$;
rollback;
