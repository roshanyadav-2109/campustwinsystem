-- Events that send notifications. Each event only drops one small row into
-- notification_outbox (it can never block or fail the attendance, payment or
-- leave save). Every minute fan_out_notifications() works out who should hear
-- about it and calls notify(); a failure is recorded on the outbox row.
--
--   absence          a student marked absent today (daily attendance). Waits
--                    5 minutes so a teacher's correction cancels it.
--   fee_receipt      a payment is recorded (not refunds)
--   fee_due          daily at 09:00 IST: bills due in 3 days and due today
--   leave_decision   a student's leave approved/declined (to parents);
--                    a staff member's leave approved/declined (to them)
--   announcement     a published announcement, to the parents it is for
begin;

create table if not exists public.notification_outbox (
  id           bigint generated always as identity primary key,
  school_id    bigint not null references public.school(id) on delete cascade,
  event_key    text not null,
  ref_id       bigint not null,
  payload      jsonb not null default '{}'::jsonb,
  not_before   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  sent         int,
  error        text
);
create index if not exists idx_outbox_due on public.notification_outbox (not_before) where processed_at is null;
alter table public.notification_outbox enable row level security;
-- no policies: only the database itself and the service role use it
revoke all on public.notification_outbox from anon, authenticated;
grant all on public.notification_outbox to service_role;

-- ---------- triggers (tiny, never raise) ----------
create or replace function public.outbox_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'absent' and new.period is null
     and new.on_date = (now() at time zone 'Asia/Kolkata')::date
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notification_outbox (school_id, event_key, ref_id, payload, not_before)
    values (new.school_id, 'absence', new.id, jsonb_build_object('student_id', new.student_id, 'date', new.on_date), now() + interval '5 minutes');
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists trg_outbox_attendance on public.attendance_record;
create trigger trg_outbox_attendance after insert or update of status on public.attendance_record
  for each row execute function public.outbox_attendance();

create or replace function public.outbox_fee_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(new.is_refund, false) and new.amount > 0 then
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (new.school_id, 'fee_receipt', new.id, jsonb_build_object('student_id', new.student_id));
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists trg_outbox_fee_payment on public.fee_payment;
create trigger trg_outbox_fee_payment after insert on public.fee_payment
  for each row execute function public.outbox_fee_payment();

create or replace function public.outbox_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text in ('approved', 'rejected') and old.status::text is distinct from new.status::text then
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (new.school_id, 'leave_decision', new.id, jsonb_build_object('kind', tg_argv[0]));
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists trg_outbox_leave on public.leave_application;
create trigger trg_outbox_leave after update of status on public.leave_application
  for each row execute function public.outbox_leave('student');
drop trigger if exists trg_outbox_staff_leave on public.staff_leave;
create trigger trg_outbox_staff_leave after update of status on public.staff_leave
  for each row execute function public.outbox_leave('staff');

create or replace function public.outbox_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    insert into public.notification_outbox (school_id, event_key, ref_id, not_before)
    values (new.school_id, 'announcement', new.id, greatest(now(), new.published_at));
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists trg_outbox_announcement on public.announcement;
create trigger trg_outbox_announcement after insert or update of published_at on public.announcement
  for each row execute function public.outbox_announcement();

-- daily fee reminders (bills due in 3 days, and due today)
create or replace function public.queue_fee_due_reminders() returns int
language sql security definer set search_path = '' as $$
  with q as (
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    select i.school_id, 'fee_due', i.id, jsonb_build_object('student_id', i.student_id, 'days', i.due_date - (now() at time zone 'Asia/Kolkata')::date)
    from public.fee_invoice i
    where i.status in ('due', 'part') and i.amount > coalesce(i.paid_amount, 0)
      and i.due_date - (now() at time zone 'Asia/Kolkata')::date in (0, 3)
    returning 1)
  select count(*)::int from q;
$$;
revoke all on function public.queue_fee_due_reminders() from public, anon, authenticated;

-- ---------- fan-out ----------
create or replace function public.fan_out_one(o public.notification_outbox) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school text; v_n int := 0; r record; v_student record; v_vars jsonb; v_title text; v_body text; v_link text;
begin
  select coalesce(nullif(s.short_name, ''), s.name) into v_school from public.school s where s.id = o.school_id;

  if o.event_key = 'absence' then
    -- still absent? (a correction cancels the message)
    if not exists (select 1 from public.attendance_record a where a.id = o.ref_id and a.status = 'absent') then return 0; end if;
    select st.id, st.full_name into v_student from public.student st where st.id = (o.payload ->> 'student_id')::bigint;
    v_vars := jsonb_build_object('student', v_student.full_name, 'school', v_school, 'date', to_char((o.payload ->> 'date')::date, 'DD/MM/YYYY'));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = v_student.id and gs.school_id = o.school_id loop
      if public.notify(o.school_id, 'absence', 'absence:' || v_student.id || ':' || (o.payload ->> 'date'), r.guardian_id, null, v_student.id, v_vars,
           '{student} is absent today', '{student} was marked absent at {school} on {date}. If this is unexpected, please contact the school.',
           '/dashboard/attendance') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'fee_receipt' then
    select p.id, p.amount, p.receipt_no, p.paid_on, st.id sid, st.full_name into v_student
      from public.fee_payment p join public.student st on st.id = p.student_id where p.id = o.ref_id;
    if v_student.id is null then return 0; end if;
    v_vars := jsonb_build_object('student', v_student.full_name, 'school', v_school, 'amount', to_char(v_student.amount, 'FM99,99,99,990.00'),
                                 'receipt', coalesce(v_student.receipt_no, ''), 'date', to_char(v_student.paid_on, 'DD/MM/YYYY'));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = v_student.sid and gs.school_id = o.school_id loop
      if public.notify(o.school_id, 'fee_receipt', 'fee_receipt:' || v_student.id, r.guardian_id, null, v_student.sid, v_vars,
           'Payment received: Rs {amount}', 'We received Rs {amount} for {student} on {date}. Receipt {receipt}. Thank you. {school}',
           '/dashboard/fees') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'fee_due' then
    select i.id, i.title, i.amount - coalesce(i.paid_amount, 0) bal, i.due_date, i.status, st.id sid, st.full_name into v_student
      from public.fee_invoice i join public.student st on st.id = i.student_id where i.id = o.ref_id;
    if v_student.id is null or v_student.status not in ('due', 'part') or v_student.bal <= 0 then return 0; end if;
    v_vars := jsonb_build_object('student', v_student.full_name, 'school', v_school, 'amount', to_char(v_student.bal, 'FM99,99,99,990.00'),
                                 'title', v_student.title, 'date', to_char(v_student.due_date, 'DD/MM/YYYY'));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = v_student.sid and gs.school_id = o.school_id loop
      if public.notify(o.school_id, 'fee_due', 'fee_due:' || v_student.id || ':' || (o.payload ->> 'days'), r.guardian_id, null, v_student.sid, v_vars,
           case when (o.payload ->> 'days')::int = 0 then 'Fee due today: Rs {amount}' else 'Fee due on {date}: Rs {amount}' end,
           '{title} for {student}: Rs {amount} is due on {date}. Please pay at the school office or online. {school}',
           '/dashboard/fees') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'leave_decision' and o.payload ->> 'kind' = 'student' then
    select l.id, l.status::text st, l.from_date, l.to_date, l.decision_note, s.id sid, s.full_name into v_student
      from public.leave_application l join public.student s on s.id = l.student_id where l.id = o.ref_id;
    if v_student.id is null or v_student.st not in ('approved', 'rejected') then return 0; end if;
    v_vars := jsonb_build_object('student', v_student.full_name, 'school', v_school,
      'decision', case when v_student.st = 'approved' then 'approved' else 'declined' end,
      'date', to_char(v_student.from_date, 'DD/MM/YYYY') || case when v_student.to_date <> v_student.from_date then ' to ' || to_char(v_student.to_date, 'DD/MM/YYYY') else '' end,
      'note', coalesce(v_student.decision_note, ''));
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = v_student.sid and gs.school_id = o.school_id loop
      if public.notify(o.school_id, 'leave_decision', 'leave:' || v_student.id || ':' || v_student.st, r.guardian_id, null, v_student.sid, v_vars,
           'Leave {decision} for {student}', 'The leave for {student} ({date}) was {decision}. {note}', '/dashboard/leave') is not null then v_n := v_n + 1; end if;
    end loop;

  elsif o.event_key = 'leave_decision' and o.payload ->> 'kind' = 'staff' then
    select l.id, l.status st, l.from_date, l.to_date, l.decision_note, l.staff_id into v_student from public.staff_leave l where l.id = o.ref_id;
    if v_student.id is null or v_student.st not in ('approved', 'rejected') then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'decision', case when v_student.st = 'approved' then 'approved' else 'declined' end,
      'date', to_char(v_student.from_date, 'DD/MM/YYYY') || case when v_student.to_date <> v_student.from_date then ' to ' || to_char(v_student.to_date, 'DD/MM/YYYY') else '' end,
      'note', coalesce(v_student.decision_note, ''));
    if public.notify(o.school_id, 'leave_decision', 'staff_leave:' || v_student.id || ':' || v_student.st, null, v_student.staff_id, null, v_vars,
         'Your leave was {decision}', 'Your leave ({date}) was {decision}. {note}', '/dashboard/hr') is not null then v_n := 1; end if;

  elsif o.event_key = 'announcement' then
    select a.id, a.title, a.body, a.scope::text sc, a.class_id, a.section_id, a.section_ids, a.academic_year_id into v_student
      from public.announcement a where a.id = o.ref_id and a.published_at is not null;
    if v_student.id is null then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'title', v_student.title, 'text', left(v_student.body, 600));
    for r in
      select distinct gs.guardian_id, gs.student_id
      from public.student_enrollment e
      join public.academic_year y on y.id = e.academic_year_id and y.is_current
      join public.section sec on sec.id = e.section_id
      join public.guardian_student gs on gs.student_id = e.student_id and gs.school_id = o.school_id
      where e.school_id = o.school_id and e.status = 'active'
        and (v_student.sc = 'school'
          or (v_student.sc = 'class' and sec.class_id = v_student.class_id)
          or (v_student.sc = 'section' and (e.section_id = v_student.section_id or e.section_id = any(coalesce(v_student.section_ids, '{}')))))
    loop
      -- one message per parent (siblings share it)
      if public.notify(o.school_id, 'announcement', 'announcement:' || v_student.id, r.guardian_id, null, null, v_vars,
           '{title}', '{text}', '/dashboard/announcements') is not null then v_n := v_n + 1; end if;
    end loop;
  end if;
  return v_n;
end $$;
revoke all on function public.fan_out_one(public.notification_outbox) from public, anon, authenticated;

create or replace function public.fan_out_notifications(p_limit int default 200) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.notification_outbox; v_total int := 0; v_n int;
begin
  for o in select * from public.notification_outbox where processed_at is null and not_before <= now()
           order by not_before limit p_limit for update skip locked loop
    begin
      v_n := public.fan_out_one(o);
      update public.notification_outbox set processed_at = now(), sent = v_n where id = o.id;
      v_total := v_total + v_n;
    exception when others then
      update public.notification_outbox set processed_at = now(), error = left(sqlerrm, 300) where id = o.id;
    end;
  end loop;
  return v_total;
end $$;
revoke all on function public.fan_out_notifications(int) from public, anon, authenticated;
grant execute on function public.fan_out_notifications(int) to service_role;

-- the minute job fans out first, then sends
create or replace function public.dispatch_notifications() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fan int; v_log int; v_stuck int; v_url text; v_key text;
begin
  v_fan := public.fan_out_notifications(500);
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
  return format('fan-out %s, log %s, stuck %s', v_fan, v_log, v_stuck);
end $$;
revoke all on function public.dispatch_notifications() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'notifications-fee-due';
  perform cron.schedule('notifications-fee-due', '30 3 * * *', 'select public.queue_fee_due_reminders()');   -- 09:00 IST
  perform cron.unschedule(jobid) from cron.job where jobname = 'notifications-outbox-purge';
  perform cron.schedule('notifications-outbox-purge', '45 22 * * 6', $q$delete from public.notification_outbox where processed_at < now() - interval '30 days'$q$);
end $$;
commit;
