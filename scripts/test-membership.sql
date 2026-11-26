-- Self-test for 0078: one login, office at Greenfield (8) and parent at
-- Lakeview College (12). Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_staff bigint; v_guardian bigint; v_kid bigint; n int; r text; sid bigint;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-two-places@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Two Places', 'qa-two-places@example.com', 'office') returning id into v_staff;
  select gs.guardian_id, gs.student_id into v_guardian, v_kid from public.guardian_student gs where gs.school_id = 12 limit 1;
  -- the profile (last used: Greenfield office) creates the first membership
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA Two Places', 8, v_staff);
  -- the second institution is added as a membership
  insert into public.person_membership (user_id, school_id, role, guardian_id) values (u, 12, 'guardian', v_guardian);
  select count(*) into n from public.person_membership where user_id = u; if n <> 2 then raise exception 'FAIL memberships %', n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- no website named: last used (Greenfield office)
  if public.current_school_id() <> 8 or not app.is_office() then raise exception 'FAIL fallback is not Greenfield office'; end if;

  -- on Lakeview: a parent there, not office, sees their child, not Greenfield data
  perform set_config('request.headers', '{"x-campustwin-school":"lakeview"}', true);
  if public.current_school_id() <> 12 then raise exception 'FAIL Lakeview header gave %', public.current_school_id(); end if;
  if app.is_office() or app.my_role()::text <> 'guardian' then raise exception 'FAIL role on Lakeview is % office %', app.my_role(), app.is_office(); end if;
  if not app.owns_student(v_kid) then raise exception 'FAIL parent does not own their Lakeview child'; end if;
  select count(*) into n from public.student where school_id = 8; if n <> 0 then raise exception 'FAIL Greenfield students visible on Lakeview (%)', n; end if;

  -- on Greenfield: office again, and no Lakeview children
  perform set_config('request.headers', '{"x-campustwin-school":"greenfield"}', true);
  if public.current_school_id() <> 8 or not app.is_office() then raise exception 'FAIL Greenfield header'; end if;
  if app.owns_student(v_kid) then raise exception 'FAIL Lakeview child owned on Greenfield'; end if;

  -- a website they do not belong to gives nothing new: falls back to last used
  perform set_config('request.headers', '{"x-campustwin-school":"riverside"}', true);
  if public.current_school_id() <> 8 then raise exception 'FAIL non-member header moved them to %', public.current_school_id(); end if;

  -- they see both of their institutions to switch between
  select count(*) into n from public.my_institutions(); if n <> 2 then raise exception 'FAIL my_institutions %', n; end if;
  reset role;
end $$;
rollback;
