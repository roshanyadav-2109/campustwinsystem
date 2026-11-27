-- Batch E after review: notifications to students everywhere (one message per number), results published told,
-- exam-day safety, duties per slot, transcripts with serial numbers, university results with register numbers.
begin;
alter table public.exam_incident add column if not exists penalty text check (penalty is null or penalty in ('warning', 'cancel_paper', 'cancel_all', 'debar'));
create index if not exists idx_exam_incident_open on public.exam_incident (student_id) where status = 'open';
alter table public.transcript_issue add column if not exists serial text, add column if not exists snapshot jsonb;
create unique index if not exists uq_transcript_serial on public.transcript_issue (school_id, serial) where serial is not null;
alter table public.student add column if not exists university_reg_no text check (university_reg_no is null or char_length(university_reg_no) <= 40);
create unique index if not exists uq_student_university_reg on public.student (school_id, university_reg_no) where university_reg_no is not null;
alter table public.school add column if not exists allow_own_teacher_evaluation boolean not null default false;
insert into public.notification_event_type (key, label, urgent, channels, sort)
values ('malpractice_decided', 'Malpractice decision', false, array['email'], 95) on conflict (key) do nothing;

create or replace function public.student_copy_key(p_student bigint, p_event text, p_title text, p_body text, p_vars jsonb) returns text
language sql immutable set search_path = '' as $$
  select 's' || p_student || ':' || p_event || ':' || md5(coalesce(p_title, '') || '|' || coalesce(p_body, '') || '|' || coalesce(p_vars::text, ''));
$$;

create or replace function public.notify(p_school bigint, p_event text, p_dedupe text, p_guardian bigint, p_staff bigint,
                                         p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_phone text; v_email text; s record; v_body text; v_title text; v_tsub text; v_tbody text; v_text text;
  v_to text; v_raw text; v_type record; v_on boolean; v_status text; v_err text; v_due timestamptz; v_sent int;
begin
  -- colleges and universities: whatever a parent is told, the student is told too (once), and parents only when the institution keeps them informed
  if p_guardian is not null and public.is_higher_ed(p_school) then
    if p_student is not null and p_event <> 'announcement' then
      perform public.notify_safe(p_school, p_event, public.student_copy_key(p_student, p_event, p_title, p_body, p_vars), null, null, p_student, p_vars, p_title, p_body, p_link);
    end if;
    if not coalesce((select sc.notify_guardians from public.school sc where sc.id = p_school), true) then return null; end if;
  end if;
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
    -- a student and a parent often share one number: the same message goes to it once
    if v_status = 'queued' and public.is_higher_ed(p_school) and exists (select 1 from public.notification_delivery d
         where d.school_id = p_school and d.channel = s.channel and d.to_address = v_to and d.created_at > now() - interval '1 day'
           and d.body = left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000)) then
      v_status := 'skipped'; v_err := 'The same message already went to this number';
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
    if public.notify_safe(p_school, p_event, public.student_copy_key(p_student, p_event, p_title, p_body, p_vars), null, null, p_student, p_vars, p_title, p_body, p_link) is not null then n := n + 1; end if;
  end if;
  return n;
end $$;

create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_sem public.semester; v_cr jsonb; v_ids bigint[]; v_redo bigint[]; v_by bigint := app.my_staff_id(); v_as text;
  v_revise boolean := coalesce(trim(p_revise_reason), '') <> '';
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  if v_sem.id is null then raise exception 'Unknown semester'; end if;
  -- internal marks signed off by the Head of Department, when the institution asks for it
  perform public.check_cia_signoff(p_semester, p_section);
  v_as := public.staff_titles(v_by);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cr from public.compute_course_results(p_semester, p_section) c;

  -- who is published now: complete, and new or being revised
  with cr as (select * from jsonb_to_recordset(v_cr) as x(student_id bigint, status text)),
  st as (select cr.student_id, bool_and(cr.status in ('pass', 'fail', 'absent')) complete,
                exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = cr.student_id) done
         from cr group by cr.student_id)
  select coalesce(array_agg(student_id) filter (where complete and (not done or v_revise)), '{}'),
         coalesce(array_agg(student_id) filter (where complete and done and v_revise), '{}')
    into v_ids, v_redo from st;
  if cardinality(v_ids) = 0 then return 0; end if;

  -- revising: keep the old rows, then replace them
  if cardinality(v_redo) > 0 then
    insert into public.course_result_revision (school_id, revised_by, reason, old)
    select v_school, v_by, left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr
     where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_redo);
    delete from public.course_result where semester_id = p_semester and attempt = 1 and student_id = any(v_redo);
  end if;

  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
  select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
  from jsonb_to_recordset(v_cr) as c(student_id bigint, course_id bigint, credits numeric, cia numeric, cia_max numeric, ese numeric, ese_max numeric,
                                     percent numeric, grade text, point numeric, passed boolean, status text)
  where c.student_id = any(v_ids);

  -- grace marks within the scheme's limits
  perform public.apply_grace(p_semester, v_ids);

  -- the semester line per student (failed courses count in the GPA unless the scheme says otherwise)
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by, published_as)
  select v_school, p_semester, cr.student_id,
    f.semester_no,
    sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
    round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(f.fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(f.fail_counts, true)), 0), 2),
    null, count(*) filter (where not cr.passed), v_by, v_as
  from public.course_result cr
  left join lateral (
    select es.fail_counts_in_gpa fail_counts, (2 * c.year_no - case when v_sem.kind = 'odd' then 1 else 0 end)::smallint semester_no
    from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
    where e.student_id = cr.student_id and e.academic_year_id = v_sem.academic_year_id order by (e.status = 'active') desc limit 1) f on true
  where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_ids)
  group by cr.student_id, f.fail_counts, f.semester_no
  on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
    sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by,
    published_as = excluded.published_as, published_at = now();

  -- revaluations already decided stay applied after a revision
  perform public.reapply_revaluations(p_semester, v_ids);
  -- CGPA of every published semester of these students
  perform public.refresh_cgpa(v_ids);
  -- students (and families) are told, through the outbox
  insert into public.notification_outbox (school_id, event_key, ref_id, payload)
  values (v_school, 'results_published', p_semester, jsonb_build_object('students', to_jsonb(v_ids), 'revised', v_revise));

  return cardinality(v_ids);
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

  elsif o.event_key = 'results_published' then
    for r in select x::bigint sid from jsonb_array_elements_text(o.payload -> 'students') x
             where x::bigint > coalesce(o.cursor_id, 0) order by 1 limit 200 loop
      v_n := v_n + coalesce(public.notify_family(o.school_id, 'result_published', 'result:' || o.ref_id || ':' || r.sid || case when (o.payload ->> 'revised')::boolean then ':r' || o.id else '' end, r.sid,
        jsonb_build_object('school', v_school), 'Semester results published', 'Semester results are published. See the grade card on the Results page.', '/dashboard/results'), 0);
      v_last := r.sid; v_cnt := v_cnt + 1;
    end loop;
    if v_cnt = 200 then
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

create or replace function public.generate_seating(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); sl record; n int := 0; v_need int; v_cap int;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can plan seating'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  if exists (select 1 from public.exam_seat where session_id = p_session and (present is not null or exam_date < (now() at time zone 'Asia/Kolkata')::date)) then
    raise exception 'The exam has started (attendance is marked or a paper is over); seating can no longer be re-planned';
  end if;
  delete from public.exam_duty where session_id = p_session;
  delete from public.exam_seat where session_id = p_session;
  for sl in select distinct exam_date, starts_at from public.exam_paper where session_id = p_session order by 1, 2 loop
    with c as (select x.student_id, x.sort_key, split_part(x.sort_key, '-', 1) || '-' || split_part(x.sort_key, '-', 2) grp
               from public.slot_candidates(p_session, sl.exam_date, sl.starts_at) x),
    c2 as (select c.*, row_number() over (partition by c.grp order by c.sort_key) rn from c),
    ordered as (select c2.student_id, row_number() over (order by c2.rn, c2.grp, c2.student_id) k from c2),
    rooms as (select r.id, coalesce(sum(r.capacity) over (order by r.sort, r.name rows between unbounded preceding and 1 preceding), 0) lo, sum(r.capacity) over (order by r.sort, r.name) hi
              from public.exam_room r where r.school_id = v_school and r.active
                and not exists (select 1 from public.exam_seat o where o.room_id = r.id and o.exam_date = sl.exam_date and o.starts_at = sl.starts_at and o.session_id <> p_session)),
    ins as (insert into public.exam_seat (school_id, session_id, exam_date, starts_at, student_id, room_id, seat_no)
            select v_school, p_session, sl.exam_date, sl.starts_at, o.student_id, r.id, (o.k - r.lo)::int
            from ordered o join rooms r on o.k > r.lo and o.k <= r.hi returning 1)
    select (select count(*) from ins), (select count(*) from c), (select coalesce(max(hi), 0) from rooms) into v_cap, v_need, n;
    if v_cap < v_need then
      raise exception 'On % at % there are % candidates but the free rooms seat %', to_char(sl.exam_date, 'DD Mon'), to_char(sl.starts_at, 'HH24:MI'), v_need, n;
    end if;
  end loop;
  select count(*) into n from public.exam_seat where session_id = p_session;
  return n;
end $$;

drop function if exists public.assign_duties(bigint, int);
create function public.assign_duties(p_session bigint, p_per_room int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_pool bigint[]; v_avail bigint[]; v_per int := least(greatest(coalesce(p_per_room, 1), 1), 4);
  sl record; n int := 0; k int; v_short text[] := '{}'; v_off int := 0; v_end time;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can assign duties'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  delete from public.exam_duty where session_id = p_session;
  -- exam-centre staff first, then teachers; fewest duties this year first
  select array_agg(x.id order by x.pri, x.load, x.id) into v_pool from (
    select st.id, case when exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)) then 0 else 1 end pri,
      (select count(*) from public.exam_duty d join public.exam_session es on es.id = d.session_id join public.academic_year y on y.id = es.academic_year_id and y.is_current where d.staff_id = st.id) load
    from public.staff st where st.school_id = v_school
      and (st.role in ('subject_teacher', 'class_teacher') or exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)))) x;
  if coalesce(cardinality(v_pool), 0) = 0 then raise exception 'There are no teachers to assign'; end if;
  for sl in select exam_date, starts_at, array_agg(distinct room_id) rooms from public.exam_seat where session_id = p_session group by 1, 2 order by 1, 2 loop
    select max(ends_at) into v_end from public.exam_paper where session_id = p_session and exam_date = sl.exam_date and starts_at = sl.starts_at;
    -- nobody already on duty in another exam at an overlapping time
    select array_agg(p order by i) into v_avail from unnest(v_pool) with ordinality u(p, i)
     where not exists (select 1 from public.exam_duty d join public.exam_paper op on op.session_id = d.session_id and op.exam_date = d.exam_date and op.starts_at = d.starts_at
                       where d.staff_id = u.p and d.exam_date = sl.exam_date and d.session_id <> p_session
                         and (op.starts_at, op.ends_at) overlaps (sl.starts_at, coalesce(v_end, sl.starts_at + interval '3 hours')));
    k := coalesce(cardinality(v_avail), 0);
    if k < cardinality(sl.rooms) * v_per then v_short := v_short || (to_char(sl.exam_date, 'DD Mon') || ' ' || to_char(sl.starts_at, 'HH24:MI')); end if;
    if k = 0 then continue; end if;
    insert into public.exam_duty (school_id, session_id, exam_date, starts_at, room_id, staff_id)
    select v_school, p_session, sl.exam_date, sl.starts_at, r.room, v_avail[((v_off + g.pos) % k) + 1]
    from (select room, row_number() over (order by room) rn from unnest(sl.rooms) room) r
    cross join generate_series(1, v_per) gg(j)
    cross join lateral (select ((r.rn - 1) * v_per + gg.j - 1)::int pos) g
    where (r.rn - 1) * v_per + gg.j <= k
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
    v_off := v_off + cardinality(sl.rooms) * v_per;
  end loop;
  return jsonb_build_object('assigned', n, 'short', case when cardinality(v_short) > 0 then array_to_string(v_short, ', ') end);
end $$;
revoke all on function public.assign_duties(bigint, int) from public, anon;
grant execute on function public.assign_duties(bigint, int) to authenticated;

drop function if exists public.my_room_roster(bigint, date, time);
create function public.my_room_roster(p_session bigint, p_date date, p_start time, p_room bigint default null)
returns table (seat_id bigint, seat_no int, student_name text, admission_no text, room text, present boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, x.seat_no, st.full_name, st.admission_no, r.name, x.present
  from public.exam_seat x join public.student st on st.id = x.student_id join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.exam_date = p_date and x.starts_at = p_start and x.school_id = public.current_school_id()
    and (p_room is null or x.room_id = p_room) and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()))
  order by r.name, x.seat_no;
$$;
revoke all on function public.my_room_roster(bigint, date, time, bigint) from public, anon;
grant execute on function public.my_room_roster(bigint, date, time, bigint) to authenticated;

create or replace function public.mark_exam_attendance(p_seats bigint[], p_present boolean[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if cardinality(p_seats) <> cardinality(p_present) then raise exception 'The lists do not line up'; end if;
  if exists (select 1 from public.exam_seat x join public.exam_paper p on p.session_id = x.session_id and p.exam_date = x.exam_date and p.starts_at = x.starts_at
             join public.exam_script es on es.paper_id = p.id and es.student_id = x.student_id
             where x.id = any(p_seats) and (es.status = 'decoded' or (es.marks is not null and not es.is_absent))) then
    raise exception 'Scripts for this exam are already marked; attendance is locked. The confidential section corrects it.';
  end if;
  update public.exam_seat x set present = y.present
  from unnest(p_seats, p_present) as y(id, present)
  where x.id = y.id and x.school_id = public.current_school_id() and (app.is_exams() or exists (select 1 from public.exam_duty d where d.session_id = x.session_id and d.exam_date = x.exam_date and d.starts_at = x.starts_at and d.room_id = x.room_id and d.staff_id = app.my_staff_id()));
  get diagnostics n = row_count;
  return n;
end $$;

drop function if exists public.session_seats(bigint, bigint);
create function public.session_seats(p_session bigint, p_student bigint default null, p_section bigint default null)
returns table (student_id bigint, exam_date date, starts_at time, room text, seat_no int)
language sql stable security definer set search_path = '' as $$
  select x.student_id, x.exam_date, x.starts_at, r.name, x.seat_no
  from public.exam_seat x join public.exam_room r on r.id = x.room_id
  where x.session_id = p_session and x.school_id = (select public.current_school_id())
    and (p_student is null or x.student_id = p_student)
    and (p_section is null or exists (select 1 from public.student_enrollment e where e.student_id = x.student_id and e.section_id = p_section and e.status = 'active'))
    and ((select app.is_exams()) or (select coalesce(app.is_admin_scope(), false)) or (p_student is not null and app.owns_student(p_student))
         or (p_section is not null and app.ct_of_section(p_section, null)))
  order by x.student_id, x.exam_date, x.starts_at, x.id;
$$;
revoke all on function public.session_seats(bigint, bigint, bigint) from public, anon;
grant execute on function public.session_seats(bigint, bigint, bigint) to authenticated;

create or replace function public.generate_scripts(p_paper bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; p public.exam_paper;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can code answer scripts'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if exists (select 1 from public.exam_seat st where st.session_id = p.session_id and st.exam_date = p.exam_date and st.starts_at = p.starts_at)
     and not exists (select 1 from public.exam_seat st where st.session_id = p.session_id and st.exam_date = p.exam_date and st.starts_at = p.starts_at and st.present is not null) then
    raise exception 'Mark exam-day attendance for this paper first, so absentees are coded as absent';
  end if;
  -- scripts not yet marked follow the latest attendance
  update public.exam_script x set is_absent = (st.present = false), status = case when st.present = false then 'marked' else 'pending' end,
         evaluator_id = case when st.present = false then x.evaluator_id else x.evaluator_id end
  from public.exam_seat st
  where x.paper_id = p_paper and x.status <> 'decoded' and x.marks is null and st.session_id = p.session_id and st.exam_date = p.exam_date
    and st.starts_at = p.starts_at and st.student_id = x.student_id and st.present is not null and x.is_absent is distinct from (st.present = false);
  insert into public.exam_script (school_id, paper_id, student_id, code, is_absent, status)
  select p.school_id, p_paper, c.student_id, upper(substr(md5(gen_random_uuid()::text), 1, 12)),
         coalesce(st.present = false, false), case when st.present = false then 'marked' else 'pending' end
  from (select student_id from public.paper_candidates(p_paper) order by random()) c
  left join public.exam_seat st on st.session_id = p.session_id and st.exam_date = p.exam_date and st.starts_at = p.starts_at and st.student_id = c.student_id
  on conflict (paper_id, student_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

drop function if exists public.decode_scripts(bigint);
create function public.decode_scripts(p_paper bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.exam_paper; v_done bigint[]; v_left int;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can decode scripts'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if p.class_id is not null then
    with w as (
      insert into public.mark (assessment_id, student_id, marks_obtained, is_absent, is_exempt, school_id, entered_by)
      select a.id, x.student_id, case when x.is_absent then null else round(x.marks, 2) end, x.is_absent, false, p.school_id, app.my_staff_id()
      from public.exam_script x
      join public.exam_session s on s.id = p.session_id
      join lateral (select e.section_id from public.student_enrollment e where e.student_id = x.student_id and e.academic_year_id = s.academic_year_id
                    order by (e.status = 'active') desc limit 1) e on true
      join public.assessment a on a.exam_paper_id = p.id and a.section_id = e.section_id
      where x.paper_id = p.id and x.status = 'marked'
      on conflict (assessment_id, student_id) do update set marks_obtained = excluded.marks_obtained, is_absent = excluded.is_absent, is_exempt = false, entered_by = excluded.entered_by
      returning student_id)
    select coalesce(array_agg(student_id), '{}') into v_done from w;
  else
    with w as (
      update public.supp_registration r set ese_marks = case when x.is_absent then null else round(least(x.marks / nullif(p.max_marks, 0) * r.ese_max, r.ese_max), 2) end, is_absent = x.is_absent
      from public.exam_script x join public.subject sb on sb.id = p.subject_id
      where x.paper_id = p.id and x.status = 'marked' and r.session_id = p.session_id and r.student_id = x.student_id and r.course_id = sb.course_id and r.status = 'registered'
      returning r.student_id)
    select coalesce(array_agg(student_id), '{}') into v_done from w;
  end if;
  update public.exam_script set status = 'decoded', decoded_at = now() where paper_id = p.id and status = 'marked' and student_id = any(v_done);
  select count(*) into v_left from public.exam_script where paper_id = p.id and status = 'marked';
  return jsonb_build_object('decoded', cardinality(v_done), 'left', v_left,
    'codes', (select string_agg(code, ', ' order by code) from (select code from public.exam_script where paper_id = p.id and status = 'marked' order by code limit 30) c));
end $$;
revoke all on function public.decode_scripts(bigint) from public, anon;
grant execute on function public.decode_scripts(bigint) to authenticated;

create or replace function public.allot_evaluators(p_paper bigint, p_staff bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; v_bad text; p public.exam_paper;
begin
  if not app.is_confidential() then raise exception 'Only the confidential section can allot scripts'; end if;
  if coalesce(cardinality(p_staff), 0) = 0 then raise exception 'Choose the evaluators'; end if;
  select * into p from public.exam_paper where id = p_paper and school_id = public.current_school_id();
  if p.id is null then raise exception 'Unknown paper'; end if;
  if exists (select 1 from unnest(p_staff) x where not exists (select 1 from public.staff s where s.id = x and s.school_id = p.school_id)) then raise exception 'Unknown staff member'; end if;
  -- not the confidential section itself, and not the teacher of these candidates for this subject
  select string_agg(distinct s.full_name, ', ') into v_bad from unnest(p_staff) x join public.staff s on s.id = x
   where exists (select 1 from public.staff_position sp join public.position_title t on t.id = sp.title_id where sp.staff_id = x and t.access_type in ('confidential', 'exams_head') and (sp.ends_on is null or sp.ends_on >= current_date))
      or (not coalesce((select allow_own_teacher_evaluation from public.school where id = p.school_id), false) and exists (select 1 from public.teacher_allotment ta join public.exam_script es on es.paper_id = p_paper
                 join public.student_enrollment e on e.student_id = es.student_id and e.section_id = ta.section_id and e.status = 'active'
                 join public.exam_session s on s.id = p.session_id
                 where ta.staff_id = x and ta.subject_id = p.subject_id and e.academic_year_id = s.academic_year_id));
  if v_bad is not null then raise exception 'Cannot evaluate this paper (confidential section, or teaches these candidates): %', v_bad; end if;
  update public.exam_script x set evaluator_id = p_staff[((y.k - 1) % cardinality(p_staff)) + 1]
  from (select id, row_number() over (order by code) k from public.exam_script where paper_id = p_paper and status = 'pending') y
  where x.id = y.id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_own_teacher_evaluation(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or the office) can change this'; end if;
  update public.school set allow_own_teacher_evaluation = coalesce(p_on, false) where id = public.current_school_id();
end $$;
revoke all on function public.set_own_teacher_evaluation(boolean) from public, anon;
grant execute on function public.set_own_teacher_evaluation(boolean) to authenticated;

drop function if exists public.decide_incident(bigint, text, text);
create function public.decide_incident(p_id bigint, p_status text, p_decision text, p_penalty text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.exam_incident; v_pen text := case when p_status = 'penalised' then coalesce(p_penalty, 'warning') end;
begin
  if not app.can_publish_results() then raise exception 'Malpractice is decided by the Controller of Examinations'; end if;
  if p_status not in ('cleared', 'penalised') then raise exception 'Clear it or record the penalty'; end if;
  if v_pen is not null and v_pen not in ('warning', 'cancel_paper', 'cancel_all', 'debar') then raise exception 'Unknown penalty'; end if;
  update public.exam_incident set status = p_status, penalty = v_pen, decision = left(trim(coalesce(p_decision, '')), 300), decided_by = app.my_staff_id()
   where id = p_id and school_id = public.current_school_id() and status = 'open' returning * into i;
  if i.id is null then raise exception 'This report is already decided'; end if;
  -- the paper written in that sitting scores zero
  if v_pen in ('cancel_paper', 'cancel_all') then
    update public.exam_script x set marks = 0, is_absent = false, status = 'marked'
    from public.exam_paper p where p.id = x.paper_id and p.session_id = i.session_id and x.student_id = i.student_id and x.status <> 'decoded'
      and (v_pen = 'cancel_all' or (p.exam_date = i.exam_date and p.starts_at = i.starts_at));
    update public.mark m set marks_obtained = 0, is_absent = false
    from public.assessment a join public.exam_paper p on p.id = a.exam_paper_id
    where a.id = m.assessment_id and m.student_id = i.student_id and p.session_id = i.session_id
      and (v_pen = 'cancel_all' or (p.exam_date = i.exam_date and p.starts_at = i.starts_at));
  end if;
  perform public.notify_family(i.school_id, 'malpractice_decided', 'malpractice:' || i.id, i.student_id,
    jsonb_build_object('decision', coalesce(nullif(i.decision, ''), case p_status when 'cleared' then 'Cleared' else initcap(replace(v_pen, '_', ' ')) end)),
    'Exam malpractice report decided', case p_status when 'cleared' then 'The report was cleared. {decision}' else 'Decision: {decision}' end, '/dashboard/results');
end $$;
revoke all on function public.decide_incident(bigint, text, text, text) from public, anon;
grant execute on function public.decide_incident(bigint, text, text, text) to authenticated;

create or replace function public.result_hold_reason(p_student bigint, p_semester bigint, p_fees boolean default true) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_manual text; v_short text; sc public.school; s public.semester; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select sr.withheld_reason into v_manual from public.semester_result sr where sr.student_id = p_student and sr.semester_id = p_semester;
  if v_manual is not null then return v_manual; end if;
  if exists (select 1 from public.exam_incident i join public.exam_session es on es.id = i.session_id join public.semester sm on sm.id = p_semester
             where i.student_id = p_student and i.status = 'open' and es.academic_year_id = sm.academic_year_id
               and (es.term = case sm.kind when 'odd' then 1 when 'even' then 2 end or es.for_semester_id = sm.id)) then
    return 'Malpractice report under inquiry';
  end if;
  if exists (select 1 from public.exam_incident i join public.exam_session es on es.id = i.session_id join public.semester sm on sm.id = p_semester
             where i.student_id = p_student and i.status = 'penalised' and i.penalty in ('cancel_all', 'debar') and es.academic_year_id = sm.academic_year_id
               and (es.term = case sm.kind when 'odd' then 1 when 'even' then 2 end or es.for_semester_id = sm.id)) then
    return 'Result withheld: malpractice penalty';
  end if;
  select * into s from public.semester where id = p_semester;
  select * into sc from public.school where id = s.school_id;
  v_short := public.attendance_shortage(p_student, p_semester);
  if v_short is not null then return 'Attendance below ' || sc.attendance_minimum || '% in ' || v_short; end if;
  if p_fees and sc.hold_results_fees and public.overdue_fees(p_student, least(v_today, s.ends_on + 1)) > 0
     and not public.fee_relaxed(p_student, v_today) then return 'Fees overdue'; end if;
  return null;
end $$;

create or replace function public.issue_transcript(p_student bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tok text; st record; v_school bigint := public.current_school_id(); v_serial text; v_sems jsonb;
begin
  if not app.is_exams() then raise exception 'Transcripts are issued by the exam cell'; end if;
  if not exists (select 1 from public.student where id = p_student and school_id = v_school) then raise exception 'Unknown student'; end if;
  if not exists (select 1 from public.course_result where student_id = p_student) then raise exception 'This student has no published results yet'; end if;
  if exists (select 1 from public.exam_incident i where i.student_id = p_student and i.status = 'open') then raise exception 'A malpractice report is open for this student'; end if;
  select * into st from public.student_standing(p_student);
  select coalesce(jsonb_agg(jsonb_build_object('no', sr.semester_no, 'sgpa', sr.sgpa) order by sm.starts_on), '[]') into v_sems
    from public.semester_result sr join public.semester sm on sm.id = sr.semester_id where sr.student_id = p_student;
  perform pg_advisory_xact_lock(hashtext('transcript-serial'), v_school::int);
  select 'TR-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_serial
    from public.transcript_issue where school_id = v_school and to_char(issued_at at time zone 'Asia/Kolkata', 'YYYY') = to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  insert into public.transcript_issue (student_id, cgpa, credits, issued_by, serial, snapshot)
  values (p_student, st.cgpa, st.credits_earned, app.my_staff_id(), v_serial,
          jsonb_build_object('semesters', v_sems, 'rows', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.student_consolidated(p_student) c)))
  returning verify_token into v_tok;
  return v_tok;
end $$;

drop function if exists public.verify_transcript(text);
create function public.verify_transcript(p_token text)
returns table (valid boolean, serial text, student_name text, programme text, cgpa numeric, credits numeric, semesters text, school_name text, issued_on date)
language sql stable security definer set search_path = '' as $$
  select t.revoked_at is null, t.serial, st.full_name,
    (select g.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
       join public.programme g on g.id = c.programme_id where e.student_id = st.id order by (e.status = 'active') desc, e.academic_year_id desc limit 1),
    t.cgpa, t.credits,
    (select string_agg('Semester ' || coalesce(x ->> 'no', '-') || ': ' || coalesce(x ->> 'sgpa', '-'), ', ') from jsonb_array_elements(coalesce(t.snapshot -> 'semesters', '[]')) x),
    sc.name, (t.issued_at at time zone 'Asia/Kolkata')::date
  from public.transcript_issue t join public.student st on st.id = t.student_id join public.school sc on sc.id = t.school_id
  where t.verify_token = p_token and length(p_token) between 20 and 64;
$$;
revoke all on function public.verify_transcript(text) from public;
grant execute on function public.verify_transcript(text) to anon, authenticated;

create or replace function public.set_register_numbers(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; v_bad text;
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or the office) can set register numbers'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5,000 rows at a time'; end if;
  select string_agg(r.admission_no, ', ') into v_bad from jsonb_to_recordset(p_rows) as r(admission_no text, register_no text)
   where not exists (select 1 from public.student s where s.school_id = public.current_school_id() and s.admission_no = trim(r.admission_no));
  if v_bad is not null then raise exception 'Unknown admission numbers: %', left(v_bad, 300); end if;
  update public.student s set university_reg_no = nullif(trim(r.register_no), '')
  from jsonb_to_recordset(p_rows) as r(admission_no text, register_no text)
  where s.school_id = public.current_school_id() and s.admission_no = trim(r.admission_no);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_register_numbers(jsonb) from public, anon;
grant execute on function public.set_register_numbers(jsonb) to authenticated;

create or replace function public.import_university_results(p_semester bigint, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_ids bigint[]; n int := 0; k int; v_bad text; v_m jsonb;
begin
  if not app.can_publish_results() then raise exception 'Results are imported by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  -- a row names the student by university register number or admission number
  select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'course_id', c.id, 'credits', c.credits, 'grade', nullif(trim(r.grade), ''), 'point', coalesce(r.point, 0),
         'passed', coalesce(r.passed, coalesce(r.point, 0) > 0), 'key', coalesce(nullif(trim(r.register_no), ''), trim(r.admission_no), '?') || '/' || coalesce(trim(r.course_code), '?'))), '[]')
    into v_m
  from jsonb_to_recordset(p_rows) as r(admission_no text, register_no text, course_code text, grade text, point numeric, passed boolean)
  left join public.student st on st.school_id = v_school and ((nullif(trim(r.register_no), '') is not null and st.university_reg_no = trim(r.register_no))
                                                              or (nullif(trim(r.register_no), '') is null and st.admission_no = trim(r.admission_no)))
  left join public.course c on c.school_id = v_school and c.code = trim(r.course_code);
  select string_agg(key, ', ') into v_bad from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where student_id is null or course_id is null or grade is null;
  if v_bad is not null then raise exception 'These rows do not match a student and a course: %', left(v_bad, 300); end if;
  select string_agg(distinct key, ', ') into v_bad from (select key from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) group by key, student_id, course_id having count(*) > 1) d;
  if v_bad is not null then raise exception 'These appear twice in the file: %', left(v_bad, 300); end if;
  -- where the student registered for courses this semester, only those courses
  select string_agg(u.key, ', ') into v_bad from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
   where exists (select 1 from public.course_registration cr where cr.student_id = u.student_id and cr.semester_id = p_semester)
     and not exists (select 1 from public.course_registration cr join public.programme_course pc on pc.id = cr.programme_course_id
                     where cr.student_id = u.student_id and cr.semester_id = p_semester and pc.course_id = u.course_id and coalesce(cr.status, '') <> 'dropped');
  if v_bad is not null then raise exception 'Not registered for these courses this semester: %', left(v_bad, 300); end if;
  -- results already there are revised (the old line is kept), not replaced
  insert into public.course_result_revision (school_id, revised_by, reason, old)
  select cr.school_id, app.my_staff_id(), 'Imported from the university', to_jsonb(cr)
  from public.course_result cr join jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) on u.student_id = cr.student_id and u.course_id = cr.course_id
  where cr.semester_id = p_semester and cr.attempt = 1 and (cr.grade, cr.point, cr.passed) is distinct from (u.grade, case when u.passed then u.point else 0 end, u.passed);
  update public.course_result cr set grade = u.grade, point = case when u.passed then u.point else 0 end, passed = u.passed, credits = u.credits
  from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where u.student_id = cr.student_id and u.course_id = cr.course_id and cr.semester_id = p_semester and cr.attempt = 1;
  get diagnostics k = row_count; n := n + k;
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed)
  select v_school, p_semester, u.student_id, u.course_id, 1, u.credits, u.grade, case when u.passed then u.point else 0 end, u.passed from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
  where not exists (select 1 from public.course_result cr where cr.semester_id = p_semester and cr.student_id = u.student_id and cr.course_id = u.course_id and cr.attempt = 1);
  get diagnostics k = row_count; n := n + k;
  select coalesce(array_agg(distinct student_id), '{}') into v_ids from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text);
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, backlogs, published_by, published_as)
  select v_school, p_semester, x, 0, 0, null, 0, app.my_staff_id(), 'Imported from the university' from unnest(v_ids) x
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_semester_line(x, p_semester) from unnest(v_ids) x;
  perform public.refresh_cgpa(v_ids);
  insert into public.notification_outbox (school_id, event_key, ref_id, payload)
  values (v_school, 'results_published', p_semester, jsonb_build_object('students', to_jsonb(v_ids), 'revised', true));
  return n;
end $$;
commit;
notify pgrst, 'reload schema';
