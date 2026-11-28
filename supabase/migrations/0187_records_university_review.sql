-- Records and university workflow after review: one record only for this campus's students, carried courses never twice,
-- mapping checks, the full identity on transfer, transcript requests for former students with delivery, overdue-only dues
-- with a waiver, declines cancel the fee; exams copied once; EWS, gender by category and outgoing students for NAAC.
begin;
alter table public.student_transfer add column if not exists carried_courses bigint[] not null default '{}';
alter table public.transfer_request add column if not exists detail jsonb;
alter table public.transcript_request add column if not exists delivery text not null default 'collect' check (delivery in ('collect', 'post', 'courier', 'email')),
  add column if not exists address text check (address is null or char_length(address) <= 400),
  add column if not exists requested_by uuid;
create unique index if not exists uq_transcript_request_open on public.transcript_request (student_id) where status = 'requested';
alter table public.exam_session add column if not exists source_session_id bigint references public.exam_session(id) on delete set null;
create unique index if not exists uq_exam_session_copy on public.exam_session (school_id, source_session_id) where source_session_id is not null;

drop function if exists public.student_consolidated(bigint);
create function public.student_consolidated(p_student bigint)
returns table (semester_id bigint, semester_no smallint, course_code text, course_name text, credits numeric, grade text, point numeric, attempt smallint, kind text, passed boolean, campus text)
language sql stable security definer set search_path = '' as $$
  with me as (select st.id from public.student st where st.id = p_student and st.school_id = public.current_school_id()),
  here as (
    select l.semester_id, sr.semester_no, c.code, c.name, l.credits, l.grade, l.point, l.attempt, l.kind, l.passed, null::text campus
    from (select distinct on (cr.course_id) cr.* from public.course_result cr join me on me.id = cr.student_id
          where cr.school_id = public.current_school_id() and cr.counts order by cr.course_id, cr.attempt desc) l
    join public.course c on c.id = l.course_id
    left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = p_student),
  -- every earlier campus along a chain of transfers
  chain as (
    with recursive ch as (select t.from_student, t.from_school, t.carried_courses, 1 depth from public.student_transfer t join me on me.id = t.to_student
                          union all select t.from_student, t.from_school, t.carried_courses, ch.depth + 1 from public.student_transfer t join ch on t.to_student = ch.from_student where ch.depth < 5)
    select * from ch),
  earlier as (
    select l.semester_id, sr.semester_no, c.code, c.name, l.credits, l.grade, l.point, l.attempt, l.kind, l.passed, sc.name campus
    from chain t
    join lateral (select distinct on (cr.course_id) cr.* from public.course_result cr where cr.student_id = t.from_student and cr.counts order by cr.course_id, cr.attempt desc) l on true
    join public.course c on c.id = l.course_id join public.school sc on sc.id = t.from_school
    left join public.semester_result sr on sr.semester_id = l.semester_id and sr.student_id = t.from_student
    where l.course_id <> all(t.carried_courses) and not exists (select 1 from here h where h.code = c.code)
      and public.result_hold(t.from_student, l.semester_id) is null)
  select * from (select * from here union all select * from earlier) x
  where exists (select 1 from me)
    and ((app.owns_student(p_student) and public.result_hold(p_student, x.semester_id) is null) or public.staff_sees_student(p_student) or app.is_exams())
  order by x.semester_no nulls last, x.code;
$$;
revoke all on function public.student_consolidated(bigint) from public, anon;
grant execute on function public.student_consolidated(bigint) to authenticated;

create or replace function public.transfer_student(p_from bigint, p_admission_no text, p_to bigint, p_section bigint, p_note text default null, p_allow_partial boolean default false, p_map jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.student; v_new bigint; v_adm text; v_year bigint; v_carried int; v_missing text; v_uni bigint; g record; v_g bigint; v_dues text; v_i int := 1;
  v_from_prog text; v_to_prog text; v_before numeric; v_after numeric;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can transfer between two of its campuses'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm group by mm ->> 'to_course_id' having count(*) > 1) then
    raise exception 'Two courses are mapped to the same course at the new campus; map each to its own';
  end if;
  select * into s from public.student where school_id = p_from and admission_no = trim(p_admission_no) for update;
  if s.id is null then raise exception 'No student with that admission number at this campus'; end if;
  if s.status <> 'active' then raise exception 'This student is not studying here now'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = p_to) then raise exception 'Choose a section at the new campus'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'The new campus has no current academic year'; end if;
  -- the same programme
  select pg.code into v_from_prog from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme pg on pg.id = c.programme_id where e.student_id = s.id and e.status = 'active' limit 1;
  select pg.code into v_to_prog from public.section sec join public.class c on c.id = sec.class_id join public.programme pg on pg.id = c.programme_id where sec.id = p_section;
  if v_from_prog is not null and v_to_prog is distinct from v_from_prog then raise exception 'A transfer keeps the programme: choose a % section at the new campus', v_from_prog; end if;
  -- nothing left open at this campus
  select string_agg(x, '; ') into v_dues from (
    select 'fees due' x where exists (select 1 from public.fee_invoice i where i.student_id = s.id and i.status in ('due', 'part'))
    union all select 'library books not returned' where exists (select 1 from public.library_issue l where l.student_id = s.id and l.returned_on is null)
    union all select 'hostel room not vacated' where exists (select 1 from public.hostel_allocation h where h.student_id = s.id and (h.to_date is null or h.to_date >= current_date))
    union all select 'malpractice report open' where exists (select 1 from public.exam_incident i where i.student_id = s.id and i.status = 'open')
    union all select 'revaluation pending' where exists (select 1 from public.reval_request r where r.student_id = s.id and r.status = 'pending')
    union all select 'supplementary exam pending' where exists (select 1 from public.supp_registration r where r.student_id = s.id and r.status in ('pending', 'registered') and r.result_id is null)
    union all select 'answer scripts still in valuation' where exists (select 1 from public.exam_script x where x.student_id = s.id and x.status <> 'decoded')) d;
  if v_dues is not null then raise exception 'Clear these at this campus first: %', v_dues; end if;
  -- grades that cannot be carried: refuse unless asked to go ahead (CGPA would change)
  select string_agg(distinct fc.code || coalesce(' (' || fy.name || ')', ''), ', ') into v_missing
  from public.course_result cr join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  where cr.student_id = s.id and (coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id and exists (select 1 from public.course cx where cx.id = (mm ->> 'to_course_id')::bigint and cx.school_id = p_to) limit 1), (select tc0.id from public.course tc0 where tc0.school_id = p_to and tc0.code = fc.code limit 1)) is null
     or not exists (select 1 from public.academic_year ty join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind where ty.school_id = p_to and ty.name = fy.name));
  if v_missing is not null and not coalesce(p_allow_partial, false) then
    raise exception 'These results have no matching course or semester at the new campus, so CGPA would change: %. Copy the catalogue first, or transfer anyway.', left(v_missing, 300);
  end if;
  select cgpa into v_before from public.student_standing(s.id);
  select university_id into v_uni from public.school where id = p_from;

  v_adm := s.admission_no;
  while exists (select 1 from public.student where school_id = p_to and admission_no = v_adm) loop
    v_adm := left(s.admission_no, 24) || '-TR' || case when v_i > 1 then v_i::text else '' end; v_i := v_i + 1;
  end loop;
  insert into public.student (school_id, admission_no, full_name, dob, gender, photo_path, email, phone, status, university_reg_no)
  values (p_to, v_adm, s.full_name, s.dob, s.gender, s.photo_path, s.email, s.phone, 'active', s.university_reg_no) returning id into v_new;
  insert into public.student_identity (student_id, school_id, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl,
                                      aadhaar_name, minority, disadvantaged, aay, disability_type, udid_no, rte_admission)
  select v_new, p_to, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl,
         aadhaar_name, minority, disadvantaged, aay, disability_type, udid_no, rte_admission from public.student_identity where student_id = s.id
  on conflict do nothing;
  insert into public.student_enrollment (school_id, student_id, academic_year_id, section_id, status) values (p_to, v_new, v_year, p_section, 'active');

  -- parents come along: the parent's existing record at the new campus (by login, phone or email), else a new one
  for g in select gu.*, gs.is_primary from public.guardian_student gs join public.guardian gu on gu.id = gs.guardian_id where gs.student_id = s.id loop
    select m2.guardian_id into v_g from public.person_membership m1 join public.person_membership m2 on m2.user_id = m1.user_id and m2.school_id = p_to and m2.role = 'guardian'
      where m1.guardian_id = g.id limit 1;
    if v_g is null then
      select x.id into v_g from public.guardian x where x.school_id = p_to
        and ((nullif(trim(g.phone), '') is not null and x.phone = g.phone) or (nullif(trim(g.email), '') is not null and lower(x.email) = lower(g.email))) limit 1;
    end if;
    if v_g is null then
      insert into public.guardian (school_id, full_name, relation, email, phone) values (p_to, g.full_name, g.relation, g.email, g.phone) returning id into v_g;
    end if;
    insert into public.guardian_student (school_id, guardian_id, student_id, is_primary) values (p_to, v_g, v_new, g.is_primary) on conflict do nothing;
    insert into public.person_membership (user_id, school_id, role, guardian_id)
    select m.user_id, p_to, 'guardian', v_g from public.person_membership m where m.guardian_id = g.id
    on conflict do nothing;
    v_g := null;
  end loop;
  insert into public.person_membership (user_id, school_id, role, student_id)
  select m.user_id, p_to, 'student', v_new from public.person_membership m where m.student_id = s.id
  on conflict (user_id, school_id, role) do update set student_id = excluded.student_id;
  update public.profile set school_id = p_to, student_id = v_new where student_id = s.id and role::text = 'student';

  with m as (
    select cr.*, tc.id to_course, ts.id to_sem from public.course_result cr
    join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
    left join public.course tc on tc.id = coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id and exists (select 1 from public.course cx where cx.id = (mm ->> 'to_course_id')::bigint and cx.school_id = p_to) limit 1), (select tc0.id from public.course tc0 where tc0.school_id = p_to and tc0.code = fc.code limit 1))
    left join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name
    left join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
    where cr.student_id = s.id),
  ins as (insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed, published_at, kind, counts, grace)
          select p_to, m.to_sem, v_new, m.to_course, m.attempt, m.credits, m.cia, m.cia_max, m.ese, m.ese_max, m.percent, m.grade, m.point, m.passed, m.published_at, m.kind, m.counts, m.grace
          from m where m.to_course is not null and m.to_sem is not null returning 1)
  select count(*) into v_carried from ins;
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_at, withheld_reason, published_as)
  select p_to, ts.id, v_new, sr.semester_no, sr.credits_registered, sr.credits_earned, sr.sgpa, sr.cgpa, sr.backlogs, sr.published_at, sr.withheld_reason, coalesce(sr.published_as, '') || ' (transferred)'
  from public.semester_result sr join public.semester fs on fs.id = sr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
  where sr.student_id = s.id
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_cgpa(array[v_new]);
  select cgpa into v_after from public.semester_result sr join public.semester sm on sm.id = sr.semester_id where sr.student_id = v_new order by sm.starts_on desc limit 1;

  update public.student_transport set is_active = false where student_id = s.id and is_active;
  update public.student set status = 'transferred', left_on = current_date, exit_remark = left('Transferred to ' || (select name from public.school where id = p_to), 200) where id = s.id;
  update public.student_enrollment set status = 'transferred' where student_id = s.id and status = 'active';
  insert into public.student_transfer (university_id, from_school, from_student, to_school, to_student, carried, not_carried, note, done_by, student_name, admission_no, cgpa_before, cgpa_after)
  values (v_uni, p_from, s.id, p_to, v_new, v_carried, v_missing, left(nullif(trim(coalesce(p_note, '')), ''), 300), auth.uid(), s.full_name, v_adm, v_before, v_after);
  -- which courses were carried (so the old campus's record never shows them twice)
  update public.student_transfer t set carried_courses = coalesce((select array_agg(distinct cr.course_id) from public.course_result cr join public.course fc on fc.id = cr.course_id
      where cr.student_id = s.id and coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id and exists (select 1 from public.course cx where cx.id = (mm ->> 'to_course_id')::bigint and cx.school_id = p_to) limit 1), (select tc0.id from public.course tc0 where tc0.school_id = p_to and tc0.code = fc.code limit 1)) is not null), '{}')
   where t.to_student = v_new;
  -- an open request for this student is closed by the transfer
  update public.transfer_request set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(decision_note, 'Transferred')
   where student_id = s.id and status = 'requested';
  -- the family is told at the new campus
  perform public.notify_family(p_to, 'leave_decision', 'transfer:' || v_new, v_new, jsonb_build_object(), 'Campus transfer',
    'The transfer to ' || (select name from public.school where id = p_to) || ' is done. Admission number ' || v_adm || '.', '/dashboard');
  return jsonb_build_object('student_id', v_new, 'admission_no', v_adm, 'carried', v_carried, 'not_carried', v_missing, 'cgpa_before', v_before, 'cgpa_after', v_after);
end $$;
revoke all on function public.transfer_student(bigint, text, bigint, bigint, text, boolean, jsonb) from public, anon;
grant execute on function public.transfer_student(bigint, text, bigint, bigint, text, boolean, jsonb) to authenticated;

create or replace function public.decide_transfer_request(p_id bigint, p_approve boolean, p_section bigint, p_map jsonb, p_note text, p_allow_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.transfer_request; j jsonb; v_no text; v_yr text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
begin
  if not exists (select 1 from public.transfer_request x where x.id = p_id and app.is_central_for(x.from_school)) then raise exception 'Only central administration decides transfers'; end if;
  select * into r from public.transfer_request where id = p_id for update;
  if r.id is null or r.status <> 'requested' then raise exception 'No waiting request'; end if;
  if not p_approve then
    update public.transfer_request set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300) where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;
  -- what the order records: the programme and semester, and each course accepted
  r.detail := jsonb_build_object(
    'programme', (select g.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id where e.student_id = r.student_id and e.status = 'active' limit 1),
    'register_no', (select university_reg_no from public.student where id = r.student_id),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('from', fc.code || ' ' || fc.name, 'credits', cr.credits, 'grade', cr.grade,
        'to', (select tc.code || ' ' || tc.name from public.course tc where tc.id = coalesce((select (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm where (mm ->> 'from_course_id')::bigint = fc.id limit 1),
                                                                                       (select tc0.id from public.course tc0 where tc0.school_id = r.to_school and tc0.code = fc.code limit 1)))) order by fc.code)
      from (select distinct on (cr0.course_id) cr0.* from public.course_result cr0 where cr0.student_id = r.student_id and cr0.counts order by cr0.course_id, cr0.attempt desc) cr
      join public.course fc on fc.id = cr.course_id), '[]'));
  j := public.transfer_student(r.from_school, (select admission_no from public.student where id = r.student_id), r.to_school, p_section, coalesce(p_note, r.reason), p_allow_partial, p_map);
  perform pg_advisory_xact_lock(hashtext('transfer-order'), r.university_id::int);
  select 'TO-' || v_yr || '-' || lpad((coalesce(max(nullif(split_part(order_no, '-', 3), '')::int), 0) + 1)::text, 4, '0') into v_no
    from public.transfer_request where university_id = r.university_id and order_no like 'TO-' || v_yr || '-%';
  update public.transfer_request set status = 'approved', order_no = v_no, detail = r.detail, decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300),
         transfer_id = (select id from public.student_transfer where from_student = r.student_id order by id desc limit 1) where id = r.id;
  return j || jsonb_build_object('order_no', v_no);
end $$;

drop function if exists public.request_transcript(bigint, int, text, boolean);
create function public.request_transcript(p_student bigint, p_copies int, p_purpose text, p_sealed boolean, p_delivery text default 'collect', p_address text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_fee numeric; v_id bigint; v_inv bigint; v_year bigint; v_copies int := greatest(least(coalesce(p_copies, 1), 10), 1);
begin
  if not exists (select 1 from public.student where id = p_student and school_id = v_school) then raise exception 'Unknown student'; end if;
  if not (app.owns_student(p_student) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.course_result where student_id = p_student) then raise exception 'There are no results yet'; end if;
  if coalesce(p_delivery, 'collect') not in ('collect', 'post', 'courier', 'email') then raise exception 'Choose how the transcript is sent'; end if;
  if coalesce(p_delivery, 'collect') <> 'collect' and nullif(trim(p_address), '') is null then raise exception 'Give the address (or email) to send it to'; end if;
  insert into public.transcript_request (student_id, copies, purpose, sealed, delivery, address, requested_by)
  values (p_student, v_copies, left(nullif(trim(p_purpose), ''), 120), coalesce(p_sealed, false), coalesce(p_delivery, 'collect'), left(nullif(trim(p_address), ''), 400), auth.uid())
  returning id into v_id;
  select transcript_fee into v_fee from public.school where id = v_school;
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  if coalesce(v_fee, 0) > 0 and v_year is not null then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, p_student, public.section_in_semester(p_student, (select id from public.semester where school_id = v_school and is_current)), v_year,
            left('Transcript fee #' || v_id, 80), v_fee * v_copies, (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.transcript_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A transcript request is already waiting';
end $$;
revoke all on function public.request_transcript(bigint, int, text, boolean, text, text) from public, anon;
grant execute on function public.request_transcript(bigint, int, text, boolean, text, text) to authenticated;

drop function if exists public.decide_transcript_request(bigint, boolean, text);
create function public.decide_transcript_request(p_id bigint, p_issue boolean, p_note text default null, p_waive text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.transcript_request; v_tok text; v_dues text;
begin
  if not app.is_exams() then raise exception 'Transcripts are issued by the exam cell'; end if;
  select * into r from public.transcript_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' then raise exception 'No waiting request'; end if;
  if not p_issue then
    if nullif(trim(p_note), '') is null then raise exception 'Give the reason for declining'; end if;
    update public.transcript_request set status = 'rejected', note = left(trim(p_note), 200), decided_at = now() where id = r.id;
    update public.fee_invoice set status = 'cancelled' where id = r.invoice_id and status = 'due';
    perform public.notify_family(r.school_id, 'result_published', 'transcript-no:' || r.id, r.student_id, jsonb_build_object('why', left(trim(p_note), 200)),
      'Transcript request declined', 'Your transcript request was declined: {why}', '/dashboard/results');
    return null;
  end if;
  -- no dues: this fee, and anything overdue; the Controller of Examinations may waive with a reason
  select string_agg(x, '; ') into v_dues from (
    select 'the transcript fee' x where exists (select 1 from public.fee_invoice i where i.id = r.invoice_id and i.status in ('due', 'part'))
    union all select 'overdue fees' where exists (select 1 from public.fee_invoice i where i.student_id = r.student_id and i.status in ('due', 'part') and i.id is distinct from r.invoice_id and i.due_date < (now() at time zone 'Asia/Kolkata')::date)
    union all select 'library books not returned' where exists (select 1 from public.library_issue l where l.student_id = r.student_id and l.returned_on is null)) d;
  if v_dues is not null then
    if nullif(trim(p_waive), '') is null or not app.is_exams_lead() then raise exception 'Not yet: %', v_dues; end if;
  end if;
  v_tok := public.issue_transcript(r.student_id);
  update public.transcript_request set status = 'issued', transcript_id = (select id from public.transcript_issue where verify_token = v_tok),
    note = left(nullif(trim(concat_ws(' ', p_note, case when v_dues is not null then 'Dues waived: ' || trim(p_waive) end)), ''), 200), decided_at = now() where id = r.id;
  perform public.notify_family(r.school_id, 'result_published', 'transcript:' || r.id, r.student_id, jsonb_build_object(), 'Transcript issued',
    'Your transcript is issued. Download it on the Results page' || case when r.sealed then ' (sealed copies from the exam cell)' else '' end || '.', '/dashboard/results');
  return v_tok;
end $$;
revoke all on function public.decide_transcript_request(bigint, boolean, text, text) from public, anon;
grant execute on function public.decide_transcript_request(bigint, boolean, text, text) to authenticated;

create or replace function public.withdraw_transcript_request(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.transcript_request;
begin
  select * into r from public.transcript_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' or not (app.owns_student(r.student_id) or app.is_exams()) then raise exception 'Nothing to withdraw'; end if;
  update public.transcript_request set status = 'withdrawn', decided_at = now() where id = r.id;
  update public.fee_invoice set status = 'cancelled' where id = r.invoice_id and status = 'due';
end $$;
revoke all on function public.withdraw_transcript_request(bigint) from public, anon;
grant execute on function public.withdraw_transcript_request(bigint) to authenticated;

create or replace function public.copy_exam_session(p_session bigint, p_to bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare es public.exam_session; v_new bigint; v_year bigint; v_type bigint; n int; v_skip int;
begin
  select * into es from public.exam_session where id = p_session;
  if es.id is null or not app.is_central_for(es.school_id) or not app.is_central_for(p_to) or es.school_id = p_to then raise exception 'Only central administration can copy an exam between its campuses'; end if;
  if exists (select 1 from public.exam_session where school_id = p_to and source_session_id = p_session) then raise exception 'This exam is already copied to that campus'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'That campus has no current year'; end if;
  select t2.id into v_type from public.assessment_type t1 join public.assessment_type t2 on t2.school_id = p_to and t2.code = t1.code where t1.id = es.assessment_type_id;
  if v_type is null then raise exception 'That campus has no matching kind of exam'; end if;
  insert into public.exam_session (school_id, academic_year_id, name, term, assessment_type_id, instructions, withhold_fee_dues, kind, fee_per_course, paper_max, source_session_id)
  values (p_to, v_year, es.name, es.term, v_type, es.instructions, es.withhold_fee_dues, es.kind, es.fee_per_course, es.paper_max, p_session) returning id into v_new;
  with m as (
    select p.*, (select c2.id from public.class c1 join public.class c2 on c2.school_id = p_to and lower(c2.name) = lower(c1.name) where c1.id = p.class_id) to_class,
      (select coalesce(
         (select s2.id from public.subject s1 join public.course k1 on k1.id = s1.course_id join public.course k2 on k2.school_id = p_to and k2.code = k1.code join public.subject s2 on s2.course_id = k2.id where s1.id = p.subject_id limit 1),
         (select s2.id from public.subject s1 join public.subject s2 on s2.school_id = p_to and lower(s2.name) = lower(s1.name) where s1.id = p.subject_id limit 1))) to_subject
    from public.exam_paper p where p.session_id = p_session),
  ins as (insert into public.exam_paper (school_id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
          select p_to, v_new, m.to_class, m.to_subject, m.exam_date, m.starts_at, m.ends_at, m.max_marks from m
          where m.to_subject is not null and (m.class_id is null or m.to_class is not null) returning 1)
  select (select count(*) from ins), (select count(*) from m) - (select count(*) from ins) into n, v_skip;
  return jsonb_build_object('session_id', v_new, 'papers', n, 'skipped', v_skip);
end $$;

create or replace function public.statistics_for(p_school bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with yr as (select y.id from public.academic_year y where y.school_id = p_school and y.is_current),
  en as (select e.student_id, st.gender::text gender, g.id prog_id, g.name programme, g.years, g.intake, c.year_no, i.category::text category, i.special_needs, i.minority, p.state
         from public.student_enrollment e join yr on e.academic_year_id = yr.id join public.student st on st.id = e.student_id
         join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id left join public.programme g on g.id = c.programme_id
         left join public.student_identity i on i.student_id = st.id left join public.student_profile p on p.student_id = st.id
         where e.status = 'active' and e.school_id = p_school),
  stf as (select s.* from public.staff s where s.school_id = p_school and s.role in ('subject_teacher', 'class_teacher', 'principal')),
  lastsem as (select sm.id from public.semester sm where sm.school_id = p_school and exists (select 1 from public.semester_result sr where sr.semester_id = sm.id) order by sm.starts_on desc limit 1)
  select jsonb_build_object(
    'students', (select count(*) from en),
    'by_gender', coalesce((select jsonb_object_agg(coalesce(gender, 'not given'), n) from (select gender, count(*) n from en group by 1) x), '{}'),
    'by_category', coalesce((select jsonb_object_agg(coalesce(category, 'not given'), n) from (select category, count(*) n from en group by 1) x), '{}'),
    'by_minority', coalesce((select jsonb_object_agg(coalesce(minority, 'not given'), n) from (select minority, count(*) n from en group by 1) x), '{}'),
    'pwd', (select count(*) from en where special_needs),
    'by_state', coalesce((select jsonb_object_agg(st2, n) from (select case when rk <= 15 then coalesce(state, 'not given') else 'others' end st2, sum(n) n from (select state, count(*) n, row_number() over (order by count(*) desc) rk from en group by 1) a group by 1) x), '{}'),
    'by_programme', coalesce((select jsonb_agg(jsonb_build_object('programme', coalesce(programme, 'Other'), 'year', year_no, 'students', n, 'female', f, 'sc', sc, 'st', st, 'obc', obc, 'ews', ews, 'pwd', pwd) order by programme, year_no)
                              from (select programme, year_no, count(*) n, count(*) filter (where lower(gender) in ('f', 'female')) f, count(*) filter (where category = 'sc') sc,
                                      count(*) filter (where category = 'st') st, count(*) filter (where category = 'obc') obc, count(*) filter (where category = 'ews') ews, count(*) filter (where special_needs) pwd from en group by 1, 2) x), '[]'),
    'gender_by_category', coalesce((select jsonb_object_agg(coalesce(category, 'not given'), g) from (select category, jsonb_object_agg(coalesce(gender, 'not given'), n) g from (select category, gender, count(*) n from en group by 1, 2) a group by category) b), '{}'),
    'intake', coalesce((select jsonb_agg(jsonb_build_object('programme', g.name, 'intake', g.intake, 'admitted', (select count(*) from en where en.prog_id = g.id and en.year_no = 1)) order by g.name)
                        from public.programme g where g.school_id = p_school), '[]'),
    'final_year', coalesce((select jsonb_agg(jsonb_build_object('programme', x.programme, 'appeared', x.appeared, 'passed', x.passed) order by x.programme) from (
                     select en.programme, count(sr.id) appeared, count(sr.id) filter (where sr.backlogs = 0 and sr.withheld_reason is null) passed
                     from en join public.semester_result sr on sr.student_id = en.student_id and sr.semester_id = (select id from lastsem)
                     where en.year_no = en.years group by en.programme) x), '[]'),
    -- outgoing students: those with a final-semester result, by academic year, the last five years
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('year', y.name, 'programme', g.name, 'appeared', x.appeared, 'passed', x.passed) order by y.start_date desc, g.name) from (
        select sm.academic_year_id, c.programme_id, count(*) appeared, count(*) filter (where sr.backlogs = 0 and sr.withheld_reason is null) passed
        from public.semester_result sr join public.semester sm on sm.id = sr.semester_id
        join lateral (select sec.class_id from public.student_enrollment e join public.section sec on sec.id = e.section_id where e.student_id = sr.student_id and e.academic_year_id = sm.academic_year_id limit 1) en1 on true
        join public.class c on c.id = en1.class_id join public.programme g0 on g0.id = c.programme_id
        where sr.school_id = p_school and sr.semester_no = g0.semesters group by 1, 2) x
      join public.academic_year y on y.id = x.academic_year_id join public.programme g on g.id = x.programme_id
      where y.start_date > (now() - interval '6 years')::date), '[]'),
    'staff', (select count(*) from stf),
    'staff_by_gender', coalesce((select jsonb_object_agg(coalesce(gender, 'not given'), n) from (select gender, count(*) n from stf group by 1) x), '{}'),
    'staff_by_qualification', coalesce((select jsonb_object_agg(coalesce(qualification, 'not given'), n) from (select qualification, count(*) n from stf group by 1) x), '{}'),
    'staff_by_appointment', coalesce((select jsonb_object_agg(coalesce(appointment, 'not given'), n) from (select appointment, count(*) n from stf group by 1) x), '{}'),
    'staff_by_title', coalesce((select jsonb_object_agg(t.name, n) from (select t.name, count(*) n from public.staff_position p join public.position_title t on t.id = p.title_id
                                where p.school_id = p_school and (p.ends_on is null or p.ends_on >= current_date) and t.access_type in ('faculty', 'dept_head', 'dean', 'head', 'deputy_head') group by t.name) t), '{}'),
    'pass_rates', coalesce((select jsonb_agg(jsonb_build_object('semester', m.kind || ' ' || to_char(m.starts_on, 'YYYY'), 'students', n, 'all_passed', p) order by m.starts_on)
                            from (select sr.semester_id, count(*) n, count(*) filter (where sr.backlogs = 0) p from public.semester_result sr where sr.school_id = p_school group by 1) x
                            join public.semester m on m.id = x.semester_id), '[]'),
    'programmes', (select count(*) from public.programme g where g.school_id = p_school),
    'departments', (select count(*) from public.department d where d.school_id = p_school));
$$;
revoke all on function public.statistics_for(bigint) from public, anon, authenticated;
commit;
notify pgrst, 'reload schema';
