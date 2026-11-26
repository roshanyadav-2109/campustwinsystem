-- Self-test for 0094 on Greenfield (8). Rolled back.
begin;
do $$ declare k1 record; k2 record; v_att bigint; v_att2 bigint; v_pay bigint; v_inv bigint; v_leave bigint; v_ann bigint; c int; v_expected int;
begin
  -- two students with a parent and no attendance today
  select e.student_id, e.section_id, e.academic_year_id, gs.guardian_id into k1
    from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current
    join public.guardian_student gs on gs.student_id = e.student_id
   where e.school_id = 8 and e.status = 'active'
     and not exists (select 1 from public.attendance_record a where a.student_id = e.student_id and a.on_date = (now() at time zone 'Asia/Kolkata')::date)
   order by e.student_id limit 1;
  select e.student_id, e.section_id, e.academic_year_id, gs.guardian_id into k2
    from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current
    join public.guardian_student gs on gs.student_id = e.student_id
   where e.school_id = 8 and e.status = 'active' and e.student_id <> k1.student_id
     and not exists (select 1 from public.attendance_record a where a.student_id = e.student_id and a.on_date = (now() at time zone 'Asia/Kolkata')::date)
   order by e.student_id limit 1;
  delete from public.notification_outbox where processed_at is null and school_id = 8;

  -- absence: one marked absent, one marked absent then corrected to present
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, status, school_id)
    values (k1.student_id, k1.section_id, k1.academic_year_id, (now() at time zone 'Asia/Kolkata')::date, 'absent', 8) returning id into v_att;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, status, school_id)
    values (k2.student_id, k2.section_id, k2.academic_year_id, (now() at time zone 'Asia/Kolkata')::date, 'absent', 8) returning id into v_att2;
  update public.attendance_record set status = 'present' where id = v_att2;
  if (select count(*) from public.notification_outbox where event_key = 'absence' and ref_id in (v_att, v_att2)) <> 2 then raise exception 'FAIL absence not queued'; end if;
  if (select min(not_before) from public.notification_outbox where ref_id = v_att and event_key = 'absence') < now() + interval '4 minutes' then raise exception 'FAIL absence not delayed'; end if;
  perform public.fan_out_notifications();
  if exists (select 1 from public.notification where event_key = 'absence' and student_id = k1.student_id) then raise exception 'FAIL absence sent before the wait'; end if;
  update public.notification_outbox set not_before = now() where ref_id in (v_att, v_att2) and event_key = 'absence';
  perform public.fan_out_notifications();
  if not exists (select 1 from public.notification where event_key = 'absence' and student_id = k1.student_id and guardian_id = k1.guardian_id) then raise exception 'FAIL absent student''s parent not told'; end if;
  if exists (select 1 from public.notification where event_key = 'absence' and student_id = k2.student_id) then raise exception 'FAIL corrected absence still sent'; end if;
  -- marking again does not send twice
  update public.attendance_record set status = 'present' where id = v_att;
  update public.attendance_record set status = 'absent' where id = v_att;
  update public.notification_outbox set not_before = now() where ref_id = v_att and processed_at is null;
  perform public.fan_out_notifications();
  if (select count(*) from public.notification where event_key = 'absence' and student_id = k1.student_id and guardian_id = k1.guardian_id) <> 1 then raise exception 'FAIL absence sent twice'; end if;

  -- fee: a bill due today -> reminder; a payment -> receipt
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id)
    values (k1.student_id, k1.section_id, k1.academic_year_id, 'QA term fee', 1500, 0, (now() at time zone 'Asia/Kolkata')::date, 'due', 8) returning id into v_inv;
  perform public.queue_fee_due_reminders();
  perform public.fan_out_notifications();
  if not exists (select 1 from public.notification where event_key = 'fee_due' and student_id = k1.student_id and title like 'Fee due today: Rs 1,500.00%') then raise exception 'FAIL fee due reminder'; end if;
  insert into public.fee_payment (invoice_id, student_id, amount, paid_on, mode, school_id) values (v_inv, k1.student_id, 1500, current_date, 'cash', 8) returning id into v_pay;
  perform public.fan_out_notifications();
  if not exists (select 1 from public.notification where event_key = 'fee_receipt' and student_id = k1.student_id and title = 'Payment received: Rs 1,500.00') then raise exception 'FAIL fee receipt'; end if;

  -- leave decision
  insert into public.leave_application (student_id, section_id, academic_year_id, from_date, to_date, reason, status, school_id)
    values (k1.student_id, k1.section_id, k1.academic_year_id, current_date + 1, current_date + 2, 'QA', 'pending', 8) returning id into v_leave;
  update public.leave_application set status = 'approved' where id = v_leave;
  perform public.fan_out_notifications();
  if not exists (select 1 from public.notification where event_key = 'leave_decision' and student_id = k1.student_id and title like 'Leave approved for %') then raise exception 'FAIL leave decision'; end if;

  -- announcement to one section reaches each parent there once, nobody else
  insert into public.announcement (title, body, scope, section_id, academic_year_id, published_at, school_id)
    values ('QA notice', 'Sports day on Friday.', 'section', k1.section_id, k1.academic_year_id, now(), 8) returning id into v_ann;
  perform public.fan_out_notifications();
  select count(distinct gs.guardian_id) into v_expected from public.student_enrollment e join public.guardian_student gs on gs.student_id = e.student_id
   where e.section_id = k1.section_id and e.status = 'active';
  select count(*) into c from public.notification where event_key = 'announcement' and dedupe_key = 'announcement:' || v_ann;
  if c <> v_expected or c = 0 then raise exception 'FAIL announcement reached % parents, expected %', c, v_expected; end if;
  if exists (select 1 from public.notification n where n.dedupe_key = 'announcement:' || v_ann and n.guardian_id not in
      (select gs.guardian_id from public.student_enrollment e join public.guardian_student gs on gs.student_id = e.student_id where e.section_id = k1.section_id)) then
    raise exception 'FAIL announcement reached a parent outside the section'; end if;
  if exists (select 1 from public.notification_outbox where school_id = 8 and error is not null and created_at > now() - interval '1 minute') then
    raise exception 'FAIL outbox errors: %', (select string_agg(error, ' | ') from public.notification_outbox where school_id = 8 and error is not null and created_at > now() - interval '1 minute'); end if;
end $$;
rollback;
