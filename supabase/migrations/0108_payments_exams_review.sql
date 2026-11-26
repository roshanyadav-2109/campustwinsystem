-- After the product + CTO review of online payment screens and exam timetable.
begin;

-- ===================== payments =====================
-- Sample (demo) institutions are marked; only they may use the test gateway,
-- so a real school can never clear real bills with test receipts.
alter table public.school add column if not exists is_sample boolean not null default false;
update public.school set is_sample = true
 where (slug, code) in (values ('greenfield','GFP'),('riverside','RIS'),('st-aldric','SAC'),('meridian','MIT'),('lakeview','LCA'),
                               ('westbridge-north','WBN'),('westbridge-city','WBC'),('westbridge-health','WBH'));

create or replace function public.payment_gateway_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'test' and not coalesce((select is_sample from public.school where id = new.school_id), false) then
    raise exception 'The test gateway is only for demo institutions. Add your own gateway instead.';
  end if;
  return new;
end $$;
drop trigger if exists trg_payment_gateway_guard on public.payment_gateway;
create trigger trg_payment_gateway_guard before insert or update on public.payment_gateway for each row execute function public.payment_gateway_guard();

-- switching a gateway on goes through one function (checks keys, one active)
revoke update (active) on public.payment_gateway from authenticated;
revoke insert on public.payment_gateway from authenticated;
grant insert (provider, label, mode, config, updated_at) on public.payment_gateway to authenticated;
create or replace function public.set_active_gateway(p_gateway bigint, p_connected text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); g public.payment_gateway;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change payment settings'; end if;
  if p_gateway is not null then
    select * into g from public.payment_gateway where id = p_gateway and school_id = v_school;
    if g.id is null then raise exception 'Unknown gateway'; end if;
    if not (g.provider = any(p_connected)) then raise exception 'This gateway is not connected yet'; end if;
    if g.provider <> 'test' and g.secret_id is null then raise exception 'Save the gateway keys first'; end if;
  end if;
  update public.payment_gateway set active = false, updated_at = now() where school_id = v_school and active and id is distinct from p_gateway;
  if p_gateway is not null then update public.payment_gateway set active = true, updated_at = now() where id = p_gateway; end if;
end $$;
revoke all on function public.set_active_gateway(bigint, text[]) from public, anon;
grant execute on function public.set_active_gateway(bigint, text[]) to authenticated;

-- every parent of the child (and the student) can see the payment attempt
drop policy if exists po_read on public.payment_order;
create policy po_read on public.payment_order for select to authenticated
  using (school_id = (select public.current_school_id()) and (created_by = auth.uid() or (select app.is_admin_scope()) or app.owns_student(student_id)));

-- pending attempts the bank never confirms are released after 3 days
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'payment-orders-expire';
  perform cron.schedule('payment-orders-expire', '*/10 * * * *', $q$
    update public.payment_order set status = 'expired' where status = 'created' and expires_at < now() - interval '90 minutes';
    update public.payment_order set status = 'review', failure_reason = 'The bank never confirmed this payment; check with the gateway' where status = 'pending' and expires_at < now();$q$);
end $$;

-- the office resolves a payment it has checked (refunded outside, or fine)
create or replace function public.resolve_payment_order(p_order bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can resolve payments'; end if;
  select * into o from public.payment_order where id = p_order and school_id = public.current_school_id() for update;
  if o.id is null then raise exception 'Unknown payment'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write what was done'; end if;
  insert into public.payment_event (school_id, order_id, kind, detail) values (o.school_id, o.id, 'resolved', jsonb_build_object('note', left(p_note, 300), 'by', app.my_staff_id(), 'refund_due', o.refund_due));
  update public.payment_order set refund_due = 0, failure_reason = left('Resolved: ' || p_note, 200),
    status = case when status = 'review' then (case when fee_payment_id is not null then 'paid' else 'failed' end) else status end
  where id = o.id;
end $$;
revoke all on function public.resolve_payment_order(bigint, text) from public, anon;
grant execute on function public.resolve_payment_order(bigint, text) to authenticated;

-- ===================== exam timetable =====================
-- theory / practical / oral papers of one subject; optional papers in one slot
alter table public.exam_paper add column if not exists component text not null default 'Theory' check (char_length(component) between 1 and 30);
alter table public.exam_paper add column if not exists optional_group text check (optional_group is null or char_length(optional_group) <= 30);
alter table public.exam_paper drop constraint if exists exam_paper_session_id_class_id_subject_id_key;
create unique index if not exists uq_exam_paper on public.exam_paper (session_id, class_id, subject_id, component);
alter table public.exam_session drop constraint if exists exam_session_term_check;
alter table public.exam_session add constraint exam_session_term_check check (term between 1 and 6);

create or replace function public.exam_paper_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_clash text;
begin
  if tg_op = 'UPDATE' and (new.session_id <> old.session_id or new.class_id <> old.class_id or new.subject_id <> old.subject_id) then
    raise exception 'A paper cannot move to another exam, class or subject. Remove it and add a new one.';
  end if;
  select * into v_s from public.exam_session where id = new.session_id;
  if v_s.school_id is distinct from new.school_id
     or not exists (select 1 from public.class c where c.id = new.class_id and c.school_id = new.school_id)
     or not exists (select 1 from public.subject sb where sb.id = new.subject_id and sb.school_id = new.school_id) then
    raise exception 'That record belongs to another institution';
  end if;
  -- papers in the same optional group (students take one of them) may share a slot
  select sb.name into v_clash from public.exam_paper p join public.subject sb on sb.id = p.subject_id
   where p.class_id = new.class_id and p.exam_date = new.exam_date and p.id is distinct from new.id
     and p.starts_at < new.ends_at and new.starts_at < p.ends_at
     and not (p.optional_group is not null and p.optional_group = new.optional_group) limit 1;
  if v_clash is not null then raise exception 'This clashes with % for the same class at that time (put optional papers in the same group to allow it)', v_clash; end if;
  if tg_op = 'UPDATE' and new.max_marks < old.max_marks and exists (
       select 1 from public.assessment a join public.mark m on m.assessment_id = a.id where a.exam_paper_id = new.id and m.marks_obtained > new.max_marks) then
    raise exception 'Some marks already entered are above %. Correct them first.', new.max_marks;
  end if;
  return new;
end $$;

-- marks columns: one per paper (theory and practical are separate columns)
create or replace function public.exam_paper_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_sec record; v_name text;
begin
  select * into v_s from public.exam_session where id = new.session_id;
  v_name := v_s.name || case when new.component <> 'Theory' then ' (' || new.component || ')' else '' end;
  for v_sec in select id from public.section where class_id = new.class_id and school_id = new.school_id loop
    update public.assessment set name = v_name, term = v_s.term, assessment_type_id = v_s.assessment_type_id,
      assessed_on = new.exam_date, max_marks = new.max_marks
     where exam_paper_id = new.id and section_id = v_sec.id;
    if not found then
      insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, school_id, exam_paper_id, created_by)
      values (v_s.assessment_type_id, new.subject_id, v_sec.id, v_s.academic_year_id, v_s.term, v_name, new.exam_date, new.max_marks, new.school_id, new.id, app.my_staff_id());
    end if;
  end loop;
  return null;
end $$;

-- renaming or re-terming an exam updates its marks columns
create or replace function public.exam_session_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name or new.term is distinct from old.term or new.assessment_type_id is distinct from old.assessment_type_id then
    update public.assessment a set name = new.name || case when p.component <> 'Theory' then ' (' || p.component || ')' else '' end,
      term = new.term, assessment_type_id = new.assessment_type_id
    from public.exam_paper p where a.exam_paper_id = p.id and p.session_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_exam_session_sync on public.exam_session;
create trigger trg_exam_session_sync after update on public.exam_session for each row execute function public.exam_session_sync();

-- a section added later gets the columns of its class's papers
create or replace function public.section_exam_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, school_id, exam_paper_id)
  select s.assessment_type_id, p.subject_id, new.id, s.academic_year_id, s.term,
         s.name || case when p.component <> 'Theory' then ' (' || p.component || ')' else '' end, p.exam_date, p.max_marks, new.school_id, p.id
  from public.exam_paper p join public.exam_session s on s.id = p.session_id
  where p.class_id = new.class_id and p.school_id = new.school_id;
  return null;
end $$;
drop trigger if exists trg_section_exam_columns on public.section;
create trigger trg_section_exam_columns after insert on public.section for each row execute function public.section_exam_columns();

-- admit cards: a held-back card has no check code; the check needs the exam published
create or replace function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not app.is_admin_scope() and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  on conflict do nothing;
  return query
  select st.id, st.full_name, st.admission_no, e.roll_no::int, c.name || '-' || sec.name, st.photo_path,
    (v_s.withhold_fee_dues and due.bal > 0),
    case when v_s.withhold_fee_dues and due.bal > 0 then (case when app.is_office() or app.owns_student(st.id) then 'Fees overdue: Rs ' || to_char(due.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when v_s.withhold_fee_dues and due.bal > 0 then null else ac.verify_token end
  from public.student_enrollment e
  join public.student st on st.id = e.student_id
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
  left join lateral (select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) bal from public.fee_invoice i
                     where i.student_id = st.id and i.status in ('due', 'part') and i.due_date < coalesce(v_first, current_date)) due on true
  where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  order by e.roll_no nulls last, st.full_name;
end $$;

create or replace function public.verify_admit_card(p_token text)
returns table (valid boolean, student_name text, class_label text, exam_name text, school_name text)
language sql stable security definer set search_path = '' as $$
  select st.status = 'active' and s.published_at is not null, st.full_name,
         (select c.name || '-' || sec.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
           where e.student_id = st.id and e.academic_year_id = s.academic_year_id limit 1),
         s.name, sc.name
  from public.exam_admit_card ac join public.exam_session s on s.id = ac.session_id
  join public.student st on st.id = ac.student_id join public.school sc on sc.id = ac.school_id
  where ac.verify_token = p_token and length(p_token) between 20 and 64;
$$;

-- parents are told when a date sheet is published or a published paper moves
insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('exam_timetable', 'Exam date sheet published or changed', false, '{whatsapp,email}', 55)
on conflict (key) do update set label = excluded.label, channels = excluded.channels, sort = excluded.sort;
create or replace function public.outbox_exam() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_session bigint; v_school bigint; v_kind text;
begin
  if tg_table_name = 'exam_session' then
    if new.published_at is null or old.published_at is not null then return null; end if;
    v_session := new.id; v_school := new.school_id; v_kind := 'published';
  else
    select s.id, s.school_id into v_session, v_school from public.exam_session s where s.id = new.session_id and s.published_at is not null;
    if v_session is null or (new.exam_date = old.exam_date and new.starts_at = old.starts_at and new.ends_at = old.ends_at) then return null; end if;
    v_kind := 'changed';
  end if;
  if not exists (select 1 from public.notification_outbox o where o.event_key = 'exam_timetable' and o.ref_id = v_session and o.processed_at is null) then
    insert into public.notification_outbox (school_id, event_key, ref_id, payload, not_before)
    values (v_school, 'exam_timetable', v_session, jsonb_build_object('kind', v_kind, 'at', now()), now() + interval '10 minutes');
  end if;
  return null;
exception when others then raise warning 'outbox_exam: %', sqlerrm; return null;
end $$;
drop trigger if exists trg_outbox_exam_session on public.exam_session;
create trigger trg_outbox_exam_session after update of published_at on public.exam_session for each row execute function public.outbox_exam();
drop trigger if exists trg_outbox_exam_paper on public.exam_paper;
create trigger trg_outbox_exam_paper after update on public.exam_paper for each row execute function public.outbox_exam();

create or replace function public.fan_out_exam(o public.notification_outbox) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.exam_session; r record; v_n int := 0; v_vars jsonb; v_school text;
begin
  select * into s from public.exam_session where id = o.ref_id and published_at is not null;
  if s.id is null then return 0; end if;
  select coalesce(nullif(sc.short_name, ''), sc.name) into v_school from public.school sc where sc.id = s.school_id;
  v_vars := jsonb_build_object('exam', s.name, 'school', v_school, 'what', case when o.payload ->> 'kind' = 'changed' then 'has changed' else 'is out' end);
  for r in select distinct gs.guardian_id from public.exam_paper p
           join public.section sec on sec.class_id = p.class_id
           join public.student_enrollment e on e.section_id = sec.id and e.academic_year_id = s.academic_year_id and e.status = 'active'
           join public.guardian_student gs on gs.student_id = e.student_id and gs.school_id = s.school_id
           where p.session_id = s.id loop
    if public.notify_safe(s.school_id, 'exam_timetable', 'exam:' || s.id || ':' || (o.payload ->> 'at'), r.guardian_id, null, null, v_vars,
         '{exam}: date sheet {what}', '{school}: the date sheet for {exam} {what}. Open CampusTwin to see it and download the admit card.',
         '/dashboard/exam-timetable') is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.fan_out_exam(public.notification_outbox) from public, anon, authenticated;

create or replace function public.fan_out_notifications(p_limit int default 200) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.notification_outbox; v_total int := 0; v_n int; v_start timestamptz := clock_timestamp();
begin
  for o in select * from public.notification_outbox where processed_at is null and not_before <= now()
           order by not_before limit p_limit for update skip locked loop
    exit when clock_timestamp() - v_start > interval '20 seconds';
    begin
      v_n := case o.event_key when 'result_published' then public.fan_out_result(o) when 'exam_timetable' then public.fan_out_exam(o) else public.fan_out_one(o) end;
      if v_n < 0 then
        v_total := v_total - v_n - 1;
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
commit;
