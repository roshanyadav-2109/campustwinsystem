-- Self-test for uploaded certificates (0085, 0087, 0088) on Greenfield (8) as a
-- temporary office login. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_staff bigint; v_kid bigint; n text; tok text; ok boolean; r record; c1 bigint;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-cert@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Cert', 'qa-cert@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA Cert', 8, v_staff);
  select id into v_kid from public.student where school_id = 8 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- an uploaded TC keeps its own number and date; a second (duplicate) copy is allowed; the number may be empty
  insert into public.certificate (student_id, kind, content, source, number, issued_on, file_key) values (v_kid, 'transfer', '{}', 'uploaded', 'TC/88', '2026-04-01', 'k1') returning id, number, verify_token into c1, n, tok;
  if n <> 'TC/88' then raise exception 'FAIL number changed to %', n; end if;
  insert into public.certificate (student_id, kind, content, source, issued_on) values (v_kid, 'transfer', '{}', 'uploaded', '2026-05-01') returning number into n;
  if n is not null then raise exception 'FAIL empty number became %', n; end if;
  ok := false; begin insert into public.certificate (student_id, kind, content, source) values (v_kid, 'bonafide', '{}', 'uploaded'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL certificate without a date accepted'; end if;
  -- content and number never change; a file cannot be swapped
  ok := false; begin update public.certificate set number = 'X' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL number changed'; end if;
  ok := false; begin update public.certificate set file_key = 'k2' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL file swapped'; end if;
  -- withdrawn shows as cancelled and cannot come back
  update public.certificate set status = 'cancelled', cancel_reason = 'QA' where id = c1;
  ok := false; begin update public.certificate set status = 'issued' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL cancelled certificate restored'; end if;
  reset role;
  set local role anon;
  select * into r from public.verify_certificate(tok);
  if r.status <> 'cancelled' or r.source <> 'uploaded' then raise exception 'FAIL verify %', r; end if;
  reset role;
end $$;
rollback;
