-- Self-test for 0085 on Greenfield (8) as a temporary office login. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_staff bigint; v_kid bigint; c1 bigint; c2 bigint; n text; tok text; ok boolean; r record;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-cert@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Cert', 'qa-cert@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA Cert', 8, v_staff);
  select id into v_kid from public.student where school_id = 8 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.certificate (student_id, kind, format, content, number) values (v_kid, 'transfer', 'cbse', '{"rows":[]}', 'FAKE') returning id, number, verify_token into c1, n, tok;
  if n !~ '^TC/[0-9]{4}/[0-9]{4}$' then raise exception 'FAIL number %', n; end if;
  if length(tok) < 32 then raise exception 'FAIL short token'; end if;
  -- a second original TC for the same student is refused
  ok := false; begin insert into public.certificate (student_id, kind, content) values (v_kid, 'transfer', '{}'); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL two original TCs'; end if;
  -- the content cannot be changed; a duplicate print counts up
  ok := false; begin update public.certificate set content = '{"rows":[1]}' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL content changed'; end if;
  update public.certificate set copies = copies + 1 where id = c1;
  -- a bonafide gets its own series
  insert into public.certificate (student_id, kind, content) values (v_kid, 'bonafide', '{}') returning number into n;
  if n !~ '^BC/' then raise exception 'FAIL bonafide number %', n; end if;
  -- an uploaded certificate keeps the school's own number and date, and does not disturb the series
  insert into public.certificate (student_id, kind, content, source, number, issued_on) values (v_kid, 'character', '{}', 'uploaded', 'OLD/CC/77', '2024-03-31') returning number into n;
  if n <> 'OLD/CC/77' then raise exception 'FAIL uploaded number changed to %', n; end if;
  insert into public.certificate (student_id, kind, content) values (v_kid, 'character', '{}') returning number into n;
  if n !~ '^CC/[0-9]{4}/0001$' then raise exception 'FAIL series disturbed by uploaded number: %', n; end if;
  ok := false; begin insert into public.certificate (student_id, kind, content, source, issued_on) values (v_kid, 'bonafide', '{}', 'imported', '2024-01-01'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL imported certificate without a number accepted'; end if;
  reset role;
  -- anyone can check it by the token, and sees the duplicate count
  set local role anon;
  select * into r from public.verify_certificate(tok);
  if r.number is null or r.copies <> 1 or r.status <> 'issued' then raise exception 'FAIL verify %', r; end if;
  if exists (select 1 from public.verify_certificate('short')) then raise exception 'FAIL short token verified'; end if;
  reset role;
  -- cancelled shows as cancelled; cannot come back
  set local role authenticated;
  update public.certificate set status = 'cancelled', cancel_reason = 'QA' where id = c1;
  ok := false; begin update public.certificate set status = 'issued' where id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL cancelled certificate restored'; end if;
  reset role;
  if (select status from public.verify_certificate(tok)) <> 'cancelled' then raise exception 'FAIL cancelled not shown'; end if;
end $$;
rollback;
