-- Self-test for 0170 on Meridian (11): student-first notices. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); su uuid := gen_random_uuid(); v_off bigint; v_sec bigint; k bigint; v_ann bigint; o public.notification_outbox; n int;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-sf-of@example.com', 'authenticated', 'authenticated'), (su, 'qa-sf-st@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-sf-of@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off);
  select e.section_id, e.student_id into v_sec, k from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current
   where e.school_id = 11 and e.status = 'active' limit 1;
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 11, k);
  update public.school set notify_guardians = false where id = 11;
  insert into public.announcement (school_id, title, body, scope, section_id, academic_year_id, created_by)
  select 11, 'QA notice', 'QA body', 'section', v_sec, academic_year_id, v_off from public.student_enrollment where student_id = k and status = 'active' limit 1 returning id into v_ann;
  if (select count(*) from public.notification_outbox where ref_id = v_ann and event_key in ('announcement', 'announcement_students')) <> 2 then raise exception 'FAIL outbox rows'; end if;
  -- the students' run puts it in the student's own inbox
  select * into o from public.notification_outbox where ref_id = v_ann and event_key = 'announcement_students';
  n := public.fan_out_one(o);
  if n = 0 then raise exception 'FAIL no student told'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.my_notifications(50) x where x.title = 'QA notice') then raise exception 'FAIL student inbox'; end if;
  if public.my_unread_notifications() = 0 then raise exception 'FAIL unread count'; end if;
  reset role;
  -- parents switched off: the parents run tells no parent
  select * into o from public.notification_outbox where ref_id = v_ann and event_key = 'announcement';
  perform public.fan_out_one(o);
  if exists (select 1 from public.notification where dedupe_key like 'announcement:' || v_ann || '%' and guardian_id is not null) then raise exception 'FAIL parents told while switched off'; end if;
  -- results notifications reach the student
  perform public.notify_family(11, 'result_published', 'qa-sf', k, '{}'::jsonb, 'QA result', 'QA body', '/dashboard/results');
  if not exists (select 1 from public.notification where dedupe_key = 'qa-sf:s' || k and student_id = k and guardian_id is null) then raise exception 'FAIL student not told of results'; end if;
end $$;
rollback;
