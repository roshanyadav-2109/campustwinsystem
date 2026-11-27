-- Step 10, student-first notices (colleges and universities): notices, results
-- and revaluation decisions go to the student directly; parents are told too
-- unless the institution turns that off. Students get an inbox.
begin;
alter table public.school add column if not exists notify_guardians boolean not null default true;
-- a notification goes to one parent, one staff member, or (colleges and universities) the student alone
alter table public.notification drop constraint if exists notification_check;
alter table public.notification add constraint notification_check check (
  ((guardian_id is not null) <> (staff_id is not null)) or (guardian_id is null and staff_id is null and student_id is not null));
create index if not exists idx_notification_student on public.notification (student_id, created_at desc) where guardian_id is null and staff_id is null;

create or replace function public.notify(p_school bigint, p_event text, p_dedupe text, p_guardian bigint, p_staff bigint,
                                         p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_phone text; v_email text; s record; v_body text; v_title text; v_tsub text; v_tbody text; v_text text;
  v_to text; v_raw text; v_type record; v_on boolean; v_status text; v_err text; v_due timestamptz; v_sent int;
begin
  -- the recipient must belong to this institution
  if p_guardian is not null then
    select g.phone, g.email into v_phone, v_email from public.guardian g where g.id = p_guardian and g.school_id = p_school;
  elsif p_staff is not null then
    select st.phone, st.email into v_phone, v_email from public.staff st where st.id = p_staff and st.school_id = p_school;
  elsif p_student is not null then
    -- colleges and universities: the student is told directly
    select st.phone, st.email into v_phone, v_email from public.student st where st.id = p_student and st.school_id = p_school;
  end if;
  if not found then raise exception 'Recipient is not at this institution'; end if;

  select coalesce(tt.subject, p_title), coalesce(tt.body, p_body) into v_title, v_body
    from (select 1) x left join lateral (
      select subject, body from public.notification_template nt
      where nt.event_key = p_event and nt.channel = 'inbox' and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1) tt on true;
  insert into public.notification (school_id, guardian_id, staff_id, student_id, event_key, title, body, link, dedupe_key)
  values (p_school, p_guardian, p_staff, p_student, p_event,
          left(public.render_template(v_title, p_vars), 200), left(public.render_template(v_body, p_vars), 2000), p_link, p_dedupe)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return null; end if;   -- already sent for this event

  select * into v_type from public.notification_event_type where key = p_event;
  for s in select * from public.notification_setting ns where ns.school_id = p_school and ns.provider <> 'off' loop
    -- is this channel on for this event? the office's choice, else the default
    select ec.enabled into v_on from public.notification_event_channel ec where ec.school_id = p_school and ec.event_key = p_event and ec.channel = s.channel;
    if v_on is null then v_on := coalesce(s.channel = any(v_type.channels), false); end if;
    if not v_on then continue; end if;

    v_tsub := null; v_tbody := null; v_text := null;
    select nt.subject, nt.body, nt.external_id into v_tsub, v_tbody, v_text from public.notification_template nt
      where nt.event_key = p_event and nt.channel = s.channel and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1;
    v_raw := case when s.channel = 'email' then v_email else v_phone end;
    v_to := case when s.channel = 'email' then nullif(trim(lower(v_email)), '') else public.normalise_phone(v_phone) end;
    v_status := 'queued'; v_err := null; v_due := now();
    if v_to is null then
      v_status := 'skipped';
      v_err := case when v_raw is null or trim(v_raw) = '' then 'No ' || case when s.channel = 'email' then 'email' else 'phone number' end || ' on record'
                    else 'Phone number is not a valid mobile number' end;
    elsif s.daily_limit is not null then
      select count(*) into v_sent from public.notification_delivery d
        where d.school_id = p_school and d.channel = s.channel and d.status in ('queued', 'sending', 'sent')
          and d.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
      if v_sent >= s.daily_limit then v_status := 'skipped'; v_err := 'Daily limit reached'; end if;
    end if;
    if v_status = 'queued' and s.channel <> 'email' and not coalesce(v_type.urgent, false) then v_due := public.after_quiet_hours(now()); end if;
    insert into public.notification_delivery (school_id, notification_id, channel, provider, to_address, subject, body, external_id,
                                              status, last_error, priority, dedupe_key, next_attempt_at)
    values (p_school, v_id, s.channel, s.provider, v_to,
            left(public.render_template(coalesce(v_tsub, v_title), p_vars), 200),
            left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000),
            v_text, v_status, v_err, case when coalesce(v_type.urgent, false) then 1 else 5 end, p_dedupe, v_due)
    on conflict do nothing;   -- the same number already gets this message (parents sharing a phone)
  end loop;
  return v_id;
end $$;

create or replace function public.my_notifications(p_limit int default 50)
returns setof public.notification language sql stable security definer set search_path = '' as $$
  select n.* from public.notification n
  where n.school_id = public.current_school_id()
    and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()) or (n.guardian_id is null and n.staff_id is null and n.student_id is not null and n.student_id = (select m.student_id from public.current_membership() m where m.role = 'student')))
  order by n.created_at desc limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.mark_notifications_read(p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  with r as (
    update public.notification n set read_at = now()
    where n.id = any(p_ids) and n.read_at is null and n.school_id = public.current_school_id()
      and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()) or (n.guardian_id is null and n.staff_id is null and n.student_id is not null and n.student_id = (select m.student_id from public.current_membership() m where m.role = 'student')))
    returning 1)
  select count(*)::int from r;
$$;

create or replace function public.my_unread_notifications() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.notification n
  where n.school_id = public.current_school_id() and n.read_at is null
    and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()) or (n.guardian_id is null and n.staff_id is null and n.student_id is not null and n.student_id = (select m.student_id from public.current_membership() m where m.role = 'student')));
$$;

create or replace function public.outbox_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is distinct from new.published_at) then
    insert into public.notification_outbox (school_id, event_key, ref_id, not_before)
    values (new.school_id, 'announcement', new.id, greatest(now(), new.published_at));
    -- colleges and universities: notices go to the students themselves too
    if public.is_higher_ed(new.school_id) then
      insert into public.notification_outbox (school_id, event_key, ref_id, not_before)
      values (new.school_id, 'announcement_students', new.id, greatest(now(), new.published_at));
    end if;
  end if;
  return null;
exception when others then raise warning 'outbox_announcement: %', sqlerrm; return null;
end $$;

create or replace function public.fan_out_one(o public.notification_outbox) returns int
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
    -- parents, 500 per pass (at colleges and universities only when the institution keeps parents informed)
    if public.is_higher_ed(o.school_id) and not coalesce((select notify_guardians from public.school where id = o.school_id), true) then return v_n; end if;
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

  elsif o.event_key = 'announcement_students' then
    -- the students themselves (colleges and universities), 500 per pass
    select a.id, a.title, a.body, a.scope::text sc, a.class_id, a.section_id, a.section_ids, a.published_at into x
      from public.announcement a where a.id = o.ref_id;
    if x.id is null or x.published_at is null or x.published_at > now() + interval '1 minute' then return 0; end if;
    v_vars := jsonb_build_object('school', v_school, 'title', x.title, 'text', left(x.body, 600));
    for r in
      select distinct e.student_id
      from public.student_enrollment e
      join public.academic_year y on y.id = e.academic_year_id and y.is_current
      join public.section sec on sec.id = e.section_id
      where e.school_id = o.school_id and e.status = 'active' and e.student_id > coalesce(o.cursor_id, 0)
        and (x.sc = 'school'
          or (x.sc = 'class' and sec.class_id = x.class_id)
          or (x.sc = 'section' and (e.section_id = x.section_id or e.section_id = any(coalesce(x.section_ids, '{}')))))
      order by e.student_id limit 500
    loop
      if public.notify_safe(o.school_id, 'announcement', 'announcement:' || x.id || ':s' || r.student_id, null, null, r.student_id, v_vars,
           '{title}', '{text}', '/dashboard/announcements') is not null then v_n := v_n + 1; end if;
      v_last := r.student_id; v_cnt := v_cnt + 1;
    end loop;
    if v_cnt = 500 then
      update public.notification_outbox set cursor_id = v_last, sent = coalesce(sent, 0) + v_n where id = o.id;
      return -(v_n + 1);
    end if;
  end if;
  return v_n;
end $$;
revoke all on function public.fan_out_one(public.notification_outbox) from public, anon, authenticated;

create or replace function public.notify_family(p_school bigint, p_event text, p_dedupe text, p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = p_student and gs.school_id = p_school
             and (not public.is_higher_ed(p_school) or coalesce((select notify_guardians from public.school where id = p_school), true)) loop
    if public.notify_safe(p_school, p_event, p_dedupe || ':' || r.guardian_id, r.guardian_id, null, p_student, p_vars, p_title, p_body, p_link) is not null then n := n + 1; end if;
  end loop;
  -- colleges and universities: the student first, parents only when the institution keeps them informed
  if public.is_higher_ed(p_school) then
    if public.notify_safe(p_school, p_event, p_dedupe || ':s' || p_student, null, null, p_student, p_vars, p_title, p_body, p_link) is not null then n := n + 1; end if;
  end if;
  return n;
end $$;

create or replace function public.set_notify_guardians(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can change this'; end if;
  update public.school set notify_guardians = coalesce(p_on, true) where id = public.current_school_id();
end $$;
revoke all on function public.set_notify_guardians(boolean) from public, anon;
grant execute on function public.set_notify_guardians(boolean) to authenticated;
commit;
notify pgrst, 'reload schema';
