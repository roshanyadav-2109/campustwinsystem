-- After review of 0190: the transfer fee follows the request (cancelled on decline), common-exam re-sync matches class and
-- leaves seated papers, timetable notices stay in the school, remuneration is marked paid after the exam, smaller fixes.
begin;
create or replace function public.request_campus_transfer(p_student bigint, p_to bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_inv bigint; v_school bigint := public.current_school_id(); v_uni bigint; v_id bigint;
begin
  if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.student where id = p_student and school_id = v_school and status = 'active') then raise exception 'Unknown student'; end if;
  select university_id into v_uni from public.school where id = v_school;
  if v_uni is null or p_to = v_school or not exists (select 1 from public.school where id = p_to and university_id = v_uni) then raise exception 'Choose another campus of the university'; end if;
  insert into public.transfer_request (university_id, from_school, student_id, to_school, reason, requested_by)
  values (v_uni, v_school, p_student, p_to, left(nullif(trim(p_reason), ''), 300), auth.uid()) returning id into v_id;
  -- the transfer fee, when the campus charges one (it must be paid before the transfer: dues block it)
  if coalesce((select transfer_fee from public.school where id = v_school), 0) > 0 and exists (select 1 from public.academic_year where school_id = v_school and is_current) then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, p_student, public.section_in_semester(p_student, (select id from public.semester where school_id = v_school and is_current)),
            (select id from public.academic_year where school_id = v_school and is_current), left('Campus transfer fee #' || v_id, 80),
            (select transfer_fee from public.school where id = v_school), (now() at time zone 'Asia/Kolkata')::date + 7, 'due') returning id into v_inv;
    update public.transfer_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A transfer request for this student is already waiting';
end $$;

create or replace function public.decide_transfer_request(p_id bigint, p_approve boolean, p_section bigint, p_map jsonb, p_note text, p_allow_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.transfer_request; j jsonb; v_no text; v_yr text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
begin
  if not exists (select 1 from public.transfer_request x where x.id = p_id and app.is_central_for(x.from_school)) then raise exception 'Only central administration decides transfers'; end if;
  select * into r from public.transfer_request where id = p_id for update;
  if r.id is null or r.status <> 'requested' then raise exception 'No waiting request'; end if;
  if p_approve and r.receiving_ok is distinct from true and nullif(trim(p_note), '') is null then
    raise exception 'The receiving campus has not agreed yet; give a note to approve without it';
  end if;
  if not p_approve then
    update public.transfer_request set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(trim(p_note), ''), 300) where id = r.id;
    update public.fee_invoice set status = 'cancelled' where id = r.invoice_id and status = 'due';
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
  -- the mapping used becomes the university's standing equivalence for next time
  insert into public.course_equivalence (university_id, from_course_id, to_school, to_course_id)
  select r.university_id, (mm ->> 'from_course_id')::bigint, r.to_school, (mm ->> 'to_course_id')::bigint from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) mm
  where exists (select 1 from public.course c where c.id = (mm ->> 'to_course_id')::bigint and c.school_id = r.to_school)
    and exists (select 1 from public.course c where c.id = (mm ->> 'from_course_id')::bigint and c.school_id = r.from_school)
  on conflict (from_course_id, to_school) do update set to_course_id = excluded.to_course_id;
  return j || jsonb_build_object('order_no', v_no);
end $$;

drop function if exists public.resync_exam_copies(bigint);
create function public.resync_exam_copies(p_session bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare es public.exam_session; n int; v_skip int;
begin
  select * into es from public.exam_session where id = p_session;
  if es.id is null or not app.is_central_for(es.school_id) then raise exception 'Only central administration can do this'; end if;
  with pairs as (
    select cp.id cp_id, sp.exam_date, sp.starts_at, sp.ends_at, sp.max_marks,
      (exists (select 1 from public.exam_seat x where x.session_id = cp.session_id and x.exam_date = cp.exam_date and x.starts_at = cp.starts_at)
        or cp.exam_date < (now() at time zone 'Asia/Kolkata')::date) locked,
      (cp.exam_date, cp.starts_at, cp.ends_at, cp.max_marks) is distinct from (sp.exam_date, sp.starts_at, sp.ends_at, sp.max_marks) changed
    from public.exam_session cs join public.exam_paper cp on cp.session_id = cs.id
    join public.subject cps on cps.id = cp.subject_id
    left join public.class cc on cc.id = cp.class_id
    join public.exam_paper sp on sp.session_id = p_session
    join public.subject ss on ss.id = sp.subject_id and lower(ss.name) = lower(cps.name) and sp.component = cp.component
    left join public.class sc on sc.id = sp.class_id
    where cs.source_session_id = p_session
      and ((sp.class_id is null and cp.class_id is null) or lower(sc.name) = lower(cc.name))),
  upd as (update public.exam_paper p set exam_date = x.exam_date, starts_at = x.starts_at, ends_at = x.ends_at, max_marks = x.max_marks
          from pairs x where p.id = x.cp_id and x.changed and not x.locked returning 1)
  select (select count(*) from upd), (select count(*) from pairs where changed and locked) into n, v_skip;
  return jsonb_build_object('updated', n, 'skipped', v_skip);
end $$;
revoke all on function public.resync_exam_copies(bigint) from public, anon;
grant execute on function public.resync_exam_copies(bigint) to authenticated;

create or replace function public.tell_timetable_saved(p_sections bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_office(), false) then return 0; end if;
  for r in select distinct t.staff_id from public.timetable_slot t join public.academic_year y on y.id = t.academic_year_id and y.is_current where t.section_id = any(p_sections) and t.school_id = v_school and t.staff_id is not null loop
    if public.notify_safe(v_school, 'announcement', 'tt:' || r.staff_id || ':' || to_char(now(), 'YYYYMMDDHH24'), null, r.staff_id, null, '{}'::jsonb, 'New timetable', 'Your timetable has changed. See Schedule.', '/dashboard/schedule') is not null then n := n + 1; end if;
  end loop;
  for r in select distinct e.student_id from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id and c.school_id = v_school
           where e.section_id = any(p_sections) and e.status = 'active' limit 3000 loop
    perform public.notify_family(v_school, 'announcement', 'tt:' || to_char(now(), 'YYYYMMDDHH24'), r.student_id, '{}'::jsonb, 'New timetable', 'The class timetable has changed. See Schedule.', '/dashboard/schedule');
  end loop;
  return n;
end $$;

create or replace function public.mark_remuneration_paid(p_session bigint, p_staff bigint[], p_paid_on date, p_ref text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (app.is_finance() or app.is_exams_lead()) then raise exception 'Only accounts or the Controller of Examinations can mark payments'; end if;
  if exists (select 1 from public.exam_paper where session_id = p_session and exam_date >= (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'Mark payments once the last paper is over (duties can still change)';
  end if;
  insert into public.exam_remuneration_paid (school_id, session_id, staff_id, amount, paid_on, reference)
  select public.current_school_id(), p_session, r.staff_id, r.total, coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date), left(nullif(trim(p_ref), ''), 80)
  from public.exam_remuneration(p_session) r where r.staff_id = any(p_staff) and r.total > 0
  on conflict (session_id, staff_id) do update set amount = excluded.amount, paid_on = excluded.paid_on, reference = excluded.reference;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.staff_leave_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_steps text[] := '{}'; v_chain text;
begin
  new.step_log := '[]'::jsonb; new.steps := null; new.step := null; new.step_since := now();
  if not public.is_higher_ed(new.school_id) then return new; end if;
  v_chain := coalesce((select chain from public.staff_leave_type where id = new.leave_type_id), 'hod_dean');
  if v_chain in ('hod_dean', 'hod') and exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             where t.access_type = 'dept_head' and p.staff_id <> new.staff_id and p.department_id in (select app.staff_home_departments(new.staff_id))
               and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) then v_steps := v_steps || 'hod'::text; end if;
  if v_chain = 'hod_dean' and exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
             join public.department d on d.unit_id is not null and d.id in (select app.staff_home_departments(new.staff_id))
             where t.access_type = 'dean' and p.staff_id <> new.staff_id and p.unit_id is not null
               and d.unit_id in (select public.unit_descendants(p.unit_id))
               and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)) then v_steps := v_steps || 'dean'::text; end if;
  new.steps := v_steps || 'final'::text;
  new.step := new.steps[1];
  return new;
end $$;

revoke update on public.timetable_draft from authenticated;
commit;
notify pgrst, 'reload schema';
