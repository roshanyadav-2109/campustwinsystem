-- Notification events, after the product + CTO review of 0094.
-- Reliability: fan-out has its own minute job with a 20-second budget;
--   announcements go out 500 parents at a time; each message is sent on its
--   own (one bad recipient no longer drops the rest); failed rows retry 3 times.
-- Product: absence text with class; a correction when an absence is fixed
--   after the alert; one fee reminder per parent per day for all children,
--   3 days before, on the day, and overdue (3, 7, then weekly up to 8 weeks);
--   announcements also to staff (whole-school) and by WhatsApp by default;
--   class teachers told of new leave requests, principal/office of staff leave
--   requests; principal/office told at 10:30 if sections have not marked attendance.
begin;

alter table public.notification_outbox add column if not exists attempts int not null default 0;
alter table public.notification_outbox add column if not exists cursor_id bigint;
create index if not exists idx_delivery_daily on public.notification_delivery (school_id, channel, created_at);

insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('attendance_corrected', 'Absence corrected',                   true,  '{sms,whatsapp,email}', 11),
  ('leave_request',        'New leave request (to teachers)',     false, '{email}',              61),
  ('attendance_missing',   'Attendance not marked (to principal)', false, '{email}',             65)
on conflict (key) do update set label = excluded.label, urgent = excluded.urgent, channels = excluded.channels, sort = excluded.sort;
update public.notification_event_type set channels = '{whatsapp,email}' where key = 'announcement';

-- a notify() that never raises: one bad recipient must not drop the others
create or replace function public.notify_safe(p_school bigint, p_event text, p_dedupe text, p_guardian bigint, p_staff bigint,
                                              p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  return public.notify(p_school, p_event, p_dedupe, p_guardian, p_staff, p_student, p_vars, p_title, p_body, p_link);
exception when others then
  raise warning 'notify % for guardian % staff % failed: %', p_event, p_guardian, p_staff, sqlerrm;
  return null;
end $$;
revoke all on function public.notify_safe(bigint, text, text, bigint, bigint, bigint, jsonb, text, text, text) from public, anon, authenticated;

-- ---------- triggers ----------
create or replace function public.outbox_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.period is not null or new.on_date <> v_today then return null; end if;
  if new.status = 'absent' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- a re-save of the section must not restart the wait
    if not exists (select 1 from public.notification_outbox o where o.event_key = 'absence' and o.processed_at is null
                   and o.school_id = new.school_id and (o.payload ->> 'student_id')::bigint = new.student_id and o.payload ->> 'date' = new.on_date::text) then
      insert into public.notification_outbox (school_id, event_key, ref_id, payload, not_before)
      values (new.school_id, 'absence', new.id, jsonb_build_object('student_id', new.student_id, 'date', new.on_date), now() + interval '5 minutes');
    end if;
  elsif new.status <> 'absent' and (tg_op = 'INSERT' or old.status = 'absent')
     and exists (select 1 from public.notification n where n.school_id = new.school_id and n.event_key = 'absence'
                 and n.dedupe_key = 'absence:' || new.student_id || ':' || new.on_date) then
    -- the parents were told "absent"; tell them it was corrected
    insert into public.notification_outbox (school_id, event_key, ref_id, payload, not_before)
    values (new.school_id, 'attendance_corrected', new.id, jsonb_build_object('student_id', new.student_id, 'date', new.on_date), now() + interval '2 minutes');
  end if;
  return null;
exception when others then
  raise warning 'outbox_attendance: %', sqlerrm; return null;
end $$;

create or replace function public.outbox_leave_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text = 'pending' then
    insert into public.notification_outbox (school_id, event_key, ref_id, payload) values (new.school_id, 'leave_request', new.id, jsonb_build_object('kind', tg_argv[0]));
  end if;
  return null;
exception when others then raise warning 'outbox_leave_request: %', sqlerrm; return null;
end $$;
drop trigger if exists trg_outbox_leave_request on public.leave_application;
create trigger trg_outbox_leave_request after insert on public.leave_application for each row execute function public.outbox_leave_request('student');
drop trigger if exists trg_outbox_staff_leave_request on public.staff_leave;
create trigger trg_outbox_staff_leave_request after insert on public.staff_leave for each row execute function public.outbox_leave_request('staff');

-- an announcement moved to a new time is queued again for that time
create or replace function public.outbox_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is distinct from new.published_at) then
    insert into public.notification_outbox (school_id, event_key, ref_id, not_before)
    values (new.school_id, 'announcement', new.id, greatest(now(), new.published_at));
  end if;
  return null;
exception when others then raise warning 'outbox_announcement: %', sqlerrm; return null;
end $$;

-- fee reminders: one per parent per day, for all their children's bills
create or replace function public.queue_fee_due_reminders() returns int
language sql security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  due as (
    select i.school_id, gs.guardian_id
    from public.fee_invoice i cross join today
    join public.guardian_student gs on gs.student_id = i.student_id and gs.school_id = i.school_id
    where i.status in ('due', 'part') and i.amount > coalesce(i.paid_amount, 0)
      and ((i.due_date - today.d) in (3, 0) or ((today.d - i.due_date) in (3, 7)) or ((today.d - i.due_date) between 14 and 56 and (today.d - i.due_date) % 7 = 0))
    group by i.school_id, gs.guardian_id),
  q as (
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    select d.school_id, 'fee_due', d.guardian_id, jsonb_build_object('date', (select d from today))
    from due d
    where not exists (select 1 from public.notification_outbox o where o.event_key = 'fee_due' and o.ref_id = d.guardian_id
                      and o.school_id = d.school_id and o.payload ->> 'date' = (select d from today)::text)
    returning 1)
  select count(*)::int from q;
$$;
revoke all on function public.queue_fee_due_reminders() from public, anon, authenticated;

-- 10:30 IST: sections that have not marked attendance, on a day others did
create or replace function public.queue_attendance_missing() returns int
language sql security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  marked_schools as (
    select distinct ar.school_id from public.attendance_record ar, today where ar.on_date = today.d and ar.period is null),
  q as (
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    select m.school_id, 'attendance_missing', extract(epoch from (select d from today))::bigint / 86400, jsonb_build_object('date', (select d from today))
    from marked_schools m
    where not exists (select 1 from public.notification_outbox o where o.event_key = 'attendance_missing' and o.school_id = m.school_id and o.payload ->> 'date' = (select d from today)::text)
    returning 1)
  select count(*)::int from q;
$$;
revoke all on function public.queue_attendance_missing() from public, anon, authenticated;

-- ---------- fan-out ----------
-- returns how many were told; a negative number -(n+1) means "more to do" (cursor saved)
drop function if exists public.fan_out_one(public.notification_outbox);
create function public.fan_out_one(o public.notification_outbox) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school text; v_n int := 0; r record; x record; v_vars jsonb; v_lines text; v_total numeric; v_last bigint; v_cnt int := 0;
  v_year bigint;
begin
  select coalesce(nullif(s.short_name, ''), s.name) into v_school from public.school s where s.id = o.school_id;

  if o.event_key in ('absence', 'attendance_corrected') then
    if o.event_key = 'absence' and not exists (select 1 from public.attendance_record a where a.student_id = (o.payload ->> 'student_id')::bigint
           and a.on_date = (o.payload ->> 'date')::date and a.period is null and a.status = 'absent') then return 0; end if;
    if o.event_key = 'attendance_corrected' and exists (select 1 from public.attendance_record a where a.student_id = (o.payload ->> 'student_id')::bigint
           and a.on_date = (o.payload ->> 'date')::date and a.period is null and a.status = 'absent') then return 0; end if;
    select st.id, st.full_name, c.name || '-' || sec.name cls,
           (select a.status::text from public.attendance_record a where a.student_id = st.id and a.on_date = (o.payload ->> 'date')::date and a.period is null limit 1) now_status
      into x
      from public.student st
      left join public.student_enrollment e on e.student_id = st.id and e.status = 'active'
        and e.academic_year_id = (select y.id from public.academic_year y where y.school_id = o.school_id and y.is_current limit 1)
      left join public.section sec on sec.id = e.section_id left join public.class c on c.id = sec.class_id
      where st.id = (o.payload ->> 'student_id')::bigint;
    v_vars := jsonb_build_object('student', x.full_name, 'class', coalesce(x.cls, ''), 'school', v_school,
                                 'date', to_char((o.payload ->> 'date')::date, 'DD/MM/YYYY'), 'status', coalesce(x.now_status, 'present'));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = x.id and gs.school_id = o.school_id loop
      if o.event_key = 'absence' then
        if public.notify_safe(o.school_id, 'absence', 'absence:' || x.id || ':' || (o.payload ->> 'date'), r.guardian_id, null, x.id, v_vars,
             '{student} is absent today', '{school}: {student} (Class {class}) is absent today, {date}. If this is unexpected, please contact the school.',
             '/dashboard/attendance') is not null then v_n := v_n + 1; end if;
      else
        if public.notify_safe(o.school_id, 'attendance_corrected', 'corrected:' || x.id || ':' || (o.payload ->> 'date'), r.guardian_id, null, x.id, v_vars,
             'Correction: {student} is not absent', '{school}: correction for {date}. {student} (Class {class}) is marked {status}, not absent. Sorry for the earlier message.',
             '/dashboard/attendance') is not null then v_n := v_n + 1; end if;
      end if;
    end loop;

  elsif o.event_key = 'fee_receipt' then
    select p.id, p.amount, p.receipt_no, p.paid_on, st.id sid, st.full_name into x
      from public.fee_payment p join public.student st on st.id = p.student_id where p.id = o.ref_id;
    if x.id is null then return 0; end if;
    v_vars := jsonb_build_object('student', x.full_name, 'school', v_school, 'amount', to_char(x.amount, 'FM99,99,99,990.00'),
                                 'receipt', coalesce(x.receipt_no, ''), 'date', to_char(x.paid_on, 'DD/MM/YYYY'));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = x.sid and gs.school_id = o.school_id loop
      if public.notify_safe(o.school_id, 'fee_receipt', 'fee_receipt:' || x.id, r.guardian_id, null, x.sid, v_vars,
           'Payment received: Rs {amount}', '{school}: we received Rs {amount} for {student} on {date}. Receipt {receipt}. Thank you.',
           '/dashboard/fees') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'fee_due' then
    -- every unpaid bill of this parent's children that is due within 3 days or overdue
    select string_agg(st.full_name || ': Rs ' || to_char(i.amount - coalesce(i.paid_amount, 0), 'FM99,99,99,990.00')
                      || case when i.due_date < (o.payload ->> 'date')::date then ' (overdue since ' || to_char(i.due_date, 'DD/MM') || ')'
                              else ' (due ' || to_char(i.due_date, 'DD/MM') || ')' end, '; ' order by st.full_name, i.due_date),
           sum(i.amount - coalesce(i.paid_amount, 0))
      into v_lines, v_total
      from public.guardian_student gs join public.student st on st.id = gs.student_id
      join public.fee_invoice i on i.student_id = gs.student_id and i.school_id = o.school_id
     where gs.guardian_id = o.ref_id and gs.school_id = o.school_id and i.status in ('due', 'part')
       and i.amount > coalesce(i.paid_amount, 0) and i.due_date <= (o.payload ->> 'date')::date + 3;
    if v_total is null or v_total <= 0 then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'amount', to_char(v_total, 'FM99,99,99,990.00'), 'details', v_lines,
                                 'date', to_char((o.payload ->> 'date')::date, 'DD/MM/YYYY'));
    if public.notify_safe(o.school_id, 'fee_due', 'fee_due:' || o.ref_id || ':' || (o.payload ->> 'date'), o.ref_id, null, null, v_vars,
         'Fees due: Rs {amount}', '{school}: fees due Rs {amount}. {details}. Please pay at the school office or online.',
         '/dashboard/fees') is not null then v_n := 1; end if;

  elsif o.event_key = 'leave_decision' and o.payload ->> 'kind' = 'student' then
    select l.id, l.status::text st, l.from_date, l.to_date, l.decision_note, s.id sid, s.full_name into x
      from public.leave_application l join public.student s on s.id = l.student_id where l.id = o.ref_id;
    if x.id is null or x.st not in ('approved', 'rejected') then return 0; end if;
    v_vars := jsonb_build_object('student', x.full_name, 'school', v_school,
      'decision', case when x.st = 'approved' then 'approved' else 'declined' end,
      'date', to_char(x.from_date, 'DD/MM/YYYY') || case when x.to_date <> x.from_date then ' to ' || to_char(x.to_date, 'DD/MM/YYYY') else '' end,
      'note', coalesce(x.decision_note, ''));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = x.sid and gs.school_id = o.school_id loop
      if public.notify_safe(o.school_id, 'leave_decision', 'leave:' || x.id || ':' || x.st, r.guardian_id, null, x.sid, v_vars,
           'Leave {decision} for {student}', '{school}: the leave for {student} ({date}) was {decision}. {note}', '/dashboard/leave') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'leave_decision' and o.payload ->> 'kind' = 'staff' then
    select l.id, l.status st, l.from_date, l.to_date, l.decision_note, l.staff_id into x from public.staff_leave l where l.id = o.ref_id;
    if x.id is null or x.st not in ('approved', 'rejected') then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'decision', case when x.st = 'approved' then 'approved' else 'declined' end,
      'date', to_char(x.from_date, 'DD/MM/YYYY') || case when x.to_date <> x.from_date then ' to ' || to_char(x.to_date, 'DD/MM/YYYY') else '' end,
      'note', coalesce(x.decision_note, ''));
    if public.notify_safe(o.school_id, 'leave_decision', 'staff_leave:' || x.id || ':' || x.st, null, x.staff_id, null, v_vars,
         'Your leave was {decision}', 'Your leave ({date}) was {decision}. {note}', '/dashboard/hr') is not null then v_n := 1; end if;

  elsif o.event_key = 'leave_request' and o.payload ->> 'kind' = 'student' then
    select l.id, l.status::text st, l.from_date, l.to_date, l.section_id, l.academic_year_id, s.full_name into x
      from public.leave_application l join public.student s on s.id = l.student_id where l.id = o.ref_id;
    if x.id is null or x.st <> 'pending' then return 0; end if;
    v_vars := jsonb_build_object('student', x.full_name, 'school', v_school,
      'date', to_char(x.from_date, 'DD/MM/YYYY') || case when x.to_date <> x.from_date then ' to ' || to_char(x.to_date, 'DD/MM/YYYY') else '' end);
    for r in select distinct ta.staff_id from public.teacher_allotment ta where ta.section_id = x.section_id and ta.academic_year_id = x.academic_year_id and ta.is_class_teacher loop
      if public.notify_safe(o.school_id, 'leave_request', 'leave_request:' || x.id, null, r.staff_id, null, v_vars,
           'Leave request: {student}', '{student} has asked for leave ({date}). Open Leave to approve or decline.', '/dashboard/leave') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'leave_request' and o.payload ->> 'kind' = 'staff' then
    select l.id, l.status st, l.from_date, l.to_date, s.full_name into x
      from public.staff_leave l join public.staff s on s.id = l.staff_id where l.id = o.ref_id;
    if x.id is null or x.st <> 'pending' then return 0; end if;
    v_vars := jsonb_build_object('name', x.full_name, 'school', v_school,
      'date', to_char(x.from_date, 'DD/MM/YYYY') || case when x.to_date <> x.from_date then ' to ' || to_char(x.to_date, 'DD/MM/YYYY') else '' end);
    for r in select s.id from public.staff s where s.school_id = o.school_id and s.role in ('principal', 'office') loop
      if public.notify_safe(o.school_id, 'leave_request', 'staff_leave_request:' || x.id, null, r.id, null, v_vars,
           'Staff leave request: {name}', '{name} has asked for leave ({date}). Open Staff to approve or decline.', '/dashboard/hr') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'attendance_missing' then
    select y.id into v_year from public.academic_year y where y.school_id = o.school_id and y.is_current limit 1;
    select string_agg(c.name || '-' || sec.name, ', ' order by c.level, sec.name), count(*) into v_lines, v_cnt
      from public.section sec join public.class c on c.id = sec.class_id
     where sec.school_id = o.school_id
       and exists (select 1 from public.student_enrollment e where e.section_id = sec.id and e.academic_year_id = v_year and e.status = 'active')
       and not exists (select 1 from public.attendance_record ar where ar.section_id = sec.id and ar.on_date = (o.payload ->> 'date')::date and ar.period is null);
    if coalesce(v_cnt, 0) = 0 then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'count', v_cnt::text, 'sections', left(v_lines, 500), 'date', to_char((o.payload ->> 'date')::date, 'DD/MM/YYYY'));
    for r in select s.id from public.staff s where s.school_id = o.school_id and s.role in ('principal', 'office') loop
      if public.notify_safe(o.school_id, 'attendance_missing', 'attendance_missing:' || (o.payload ->> 'date'), null, r.id, null, v_vars,
           'Attendance not marked: {count} sections', 'By 10:30 on {date}, these sections had not marked attendance: {sections}. Parents of absent students are not told until it is marked.',
           '/dashboard/attendance') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'announcement' then
    select a.id, a.title, a.body, a.scope::text sc, a.class_id, a.section_id, a.section_ids, a.published_at into x
      from public.announcement a where a.id = o.ref_id;
    if x.id is null or x.published_at is null or x.published_at > now() + interval '1 minute' then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'title', x.title, 'text', left(x.body, 600));
    -- staff (whole-school notices), once, on the first pass
    if x.sc = 'school' and o.cursor_id is null then
      for r in select s.id from public.staff s where s.school_id = o.school_id loop
        perform public.notify_safe(o.school_id, 'announcement', 'announcement:' || x.id, null, r.id, null, v_vars, '{title}', '{text}', '/dashboard/announcements');
      end loop;
    end if;
    -- parents, 500 per pass
    for r in
      select distinct gs.guardian_id
      from public.student_enrollment e
      join public.academic_year y on y.id = e.academic_year_id and y.is_current
      join public.section sec on sec.id = e.section_id
      join public.guardian_student gs on gs.student_id = e.student_id and gs.school_id = o.school_id
      where e.school_id = o.school_id and e.status = 'active' and gs.guardian_id > coalesce(o.cursor_id, 0)
        and (x.sc = 'school'
          or (x.sc = 'class' and sec.class_id = x.class_id)
          or (x.sc = 'section' and (e.section_id = x.section_id or e.section_id = any(coalesce(x.section_ids, '{}')))))
      order by gs.guardian_id limit 500
    loop
      if public.notify_safe(o.school_id, 'announcement', 'announcement:' || x.id, r.guardian_id, null, null, v_vars,
           '{title}', '{text}', '/dashboard/announcements') is not null then v_n := v_n + 1; end if;
      v_last := r.guardian_id; v_cnt := v_cnt + 1;
    end loop;
    if v_cnt = 500 then
      update public.notification_outbox set cursor_id = v_last, sent = coalesce(sent, 0) + v_n where id = o.id;
      return -(v_n + 1);
    end if;
  end if;
  return v_n;
end $$;
revoke all on function public.fan_out_one(public.notification_outbox) from public, anon, authenticated;

create or replace function public.fan_out_notifications(p_limit int default 200) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.notification_outbox; v_total int := 0; v_n int; v_start timestamptz := clock_timestamp();
begin
  for o in select * from public.notification_outbox where processed_at is null and not_before <= now()
           order by not_before limit p_limit for update skip locked loop
    exit when clock_timestamp() - v_start > interval '20 seconds';
    begin
      v_n := public.fan_out_one(o);
      if v_n < 0 then
        v_total := v_total - v_n - 1;          -- more parents to do: leave it queued (cursor saved)
      else
        update public.notification_outbox set processed_at = now(), sent = coalesce(sent, 0) + v_n, error = null where id = o.id;
        v_total := v_total + v_n;
      end if;
    exception when others then
      update public.notification_outbox set attempts = attempts + 1, error = left(sqlerrm, 300),
        processed_at = case when attempts + 1 >= 3 then now() end,
        not_before = now() + (attempts + 1) * interval '5 minutes'
      where id = o.id;
    end;
  end loop;
  return v_total;
end $$;
revoke all on function public.fan_out_notifications(int) from public, anon, authenticated;
grant execute on function public.fan_out_notifications(int) to service_role;

-- sending no longer waits on fan-out (separate job)
create or replace function public.dispatch_notifications() returns text
language plpgsql security definer set search_path = '' as $$
declare v_log int; v_stuck int; v_url text; v_key text;
begin
  v_log := public.complete_log_deliveries();
  with s as (
    update public.notification_delivery set status = case when attempts >= 3 then 'failed' else 'queued' end,
      last_error = coalesce(last_error, 'Sending did not finish; retried')
    where status = 'sending' and taken_at < now() - interval '10 minutes' returning 1)
  select count(*) into v_stuck from s;
  if exists (select 1 from public.notification_delivery where status = 'queued' and provider not in ('log', 'off') and next_attempt_at <= now()) then
    v_url := app.vault_secret('notify_dispatch_url'); v_key := app.vault_secret('notify_dispatch_key');
    if v_url is not null and v_key is not null then
      perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', v_key),
                            body := '{}'::jsonb, timeout_milliseconds := 25000);
    end if;
  end if;
  return format('log %s, stuck %s', v_log, v_stuck);
end $$;
revoke all on function public.dispatch_notifications() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('notifications-fanout', 'notifications-attendance-missing');
  perform cron.schedule('notifications-fanout', '* * * * *', 'select public.fan_out_notifications(500); select public.complete_log_deliveries();');
  perform cron.schedule('notifications-attendance-missing', '0 5 * * 1-6', 'select public.queue_attendance_missing()');   -- 10:30 IST, Mon-Sat
end $$;
commit;
