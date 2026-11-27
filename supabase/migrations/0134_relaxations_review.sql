-- Attendance lock, holds and relaxations: fixes from the product + CTO review
-- of 0131-0133.
begin;
alter table public.relaxation_request drop constraint if exists relaxation_request_status_check;
alter table public.relaxation_request add constraint relaxation_request_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled', 'revoked'));

-- lecture rows only through mark_lecture (it applies the lock and logs changes)
create or replace function public.guard_lecture_rows() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and coalesce(new.period, old.period) is not null then
    raise exception 'Lecture attendance is saved through the Lectures page';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_lecture_rows on public.attendance_record;
create trigger trg_guard_lecture_rows before insert or update or delete on public.attendance_record for each row execute function public.guard_lecture_rows();

-- the chain names all three requests, each step once
create or replace function public.relax_chain_ok(c jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(c) = 'object' and c ? 'attendance' and c ? 'fees' and c ? 'unlock'
     and (select bool_and(k in ('attendance', 'fees', 'unlock')
                          and jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 3
                          and (select bool_and(x in ('advisor', 'head', 'office')) and count(distinct x) = count(*) from jsonb_array_elements_text(v) x))
          from jsonb_each(c) e(k, v));
$$;

-- helpers are internal
revoke all on function public.section_in_semester(bigint, bigint) from public, anon, authenticated;
revoke all on function public.attendance_shortage(bigint, bigint) from public, anon, authenticated;
revoke all on function public.overdue_fees(bigint, date) from public, anon, authenticated;
revoke all on function public.fee_relaxed(bigint, date) from public, anon, authenticated;

-- fees count for a semester only if they fell due by its end; the QR check ignores fee holds
drop function if exists public.result_hold_reason(bigint, bigint);
create function public.result_hold_reason(p_student bigint, p_semester bigint, p_fees boolean default true) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_manual text; v_short text; sc public.school; s public.semester; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select sr.withheld_reason into v_manual from public.semester_result sr where sr.student_id = p_student and sr.semester_id = p_semester;
  if v_manual is not null then return v_manual; end if;
  select * into s from public.semester where id = p_semester;
  select * into sc from public.school where id = s.school_id;
  v_short := public.attendance_shortage(p_student, p_semester);
  if v_short is not null then return 'Attendance below ' || sc.attendance_minimum || '% in ' || v_short; end if;
  if p_fees and sc.hold_results_fees and public.overdue_fees(p_student, least(v_today, s.ends_on + 1)) > 0
     and not public.fee_relaxed(p_student, v_today) then return 'Fees overdue'; end if;
  return null;
end $$;
revoke all on function public.result_hold_reason(bigint, bigint, boolean) from public, anon, authenticated;

create or replace function public.result_hold(p_student bigint, p_semester bigint) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.student st where st.id = p_student and st.school_id = public.current_school_id())
               and (app.my_staff_id() is not null or app.owns_student(p_student))
         then public.result_hold_reason(p_student, p_semester) end;
$$;

create or replace function public.verify_grade_card(p_token text)
returns table (valid boolean, student_name text, programme text, semester_no smallint, sgpa numeric, cgpa numeric, school_name text, published_on date)
language sql stable security definer set search_path = '' as $$
  select st.status <> 'left', st.full_name,
    (select p.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
      join public.semester s2 on s2.academic_year_id = e.academic_year_id where e.student_id = st.id and s2.id = sr.semester_id limit 1),
    sr.semester_no, sr.sgpa, sr.cgpa, sc.name, (sr.published_at at time zone 'Asia/Kolkata')::date
  from public.semester_result sr join public.student st on st.id = sr.student_id join public.school sc on sc.id = sr.school_id
  where sr.verify_token = p_token and length(p_token) between 20 and 64 and public.result_hold_reason(sr.student_id, sr.semester_id, false) is null;
$$;

-- the lock follows the semester the day belongs to; unlocks end on an IST date
create or replace function public.lecture_lock_reason(p_section bigint, p_subject bigint, p_date date) returns text
language plpgsql stable security definer set search_path = '' as $$
declare sc public.school; s public.semester; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into sc from public.school where id = public.current_school_id();
  select * into s from public.semester where school_id = sc.id and p_date between starts_on and ends_on order by is_current desc limit 1;
  if s.id is null then select * into s from public.semester where school_id = sc.id and is_current; end if;
  if exists (select 1 from public.relaxation_request r where r.kind = 'unlock' and r.status = 'approved' and r.section_id = p_section and r.subject_id = p_subject
               and r.on_date = p_date and r.until >= v_today) then return null; end if;
  if sc.attendance_lock_mode in ('cutoff', 'both') and s.attendance_cutoff is not null and v_today > s.attendance_cutoff and p_date <= s.attendance_cutoff then
    return 'Attendance up to ' || to_char(s.attendance_cutoff, 'DD Mon YYYY') || ' is frozen for exams. Ask for it to be unlocked.';
  end if;
  if sc.attendance_lock_mode in ('daily', 'both') and p_date < v_today - sc.attendance_edit_days then
    return 'Attendance locks ' || sc.attendance_edit_days || ' days after the lecture. Ask for this day to be unlocked.';
  end if;
  return null;
end $$;

-- who is the approver of a step (for notifications)
create or replace function public.relax_step_staff(p_id bigint) returns setof bigint
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; v_year bigint; v_sec bigint; t text;
begin
  select * into r from public.relaxation_request where id = p_id;
  if r.status <> 'pending' then return; end if;
  t := r.chain[r.step + 1];
  select academic_year_id into v_year from public.semester where id = r.semester_id;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  if t = 'advisor' then
    return query select ta.staff_id from public.teacher_allotment ta where ta.section_id = v_sec and ta.academic_year_id = v_year and ta.is_class_teacher;
  else
    return query select st.id from public.staff st where st.school_id = r.school_id and st.role::text = (case t when 'head' then 'principal' else 'office' end);
  end if;
end $$;
revoke all on function public.relax_step_staff(bigint) from public, anon, authenticated;

insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('relaxation_waiting', 'Relaxation or unlock waiting for approval', false, '{email}', 70),
  ('relaxation_decided', 'Relaxation or unlock decided', false, '{email}', 71)
on conflict (key) do nothing;

create or replace function public.relax_notify(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request; v_staff bigint; v_what text; v_req bigint;
begin
  select * into r from public.relaxation_request where id = p_id;
  v_what := case r.kind when 'attendance' then 'Attendance relaxation' when 'fees' then 'Fee extension' else 'Unlock attendance' end
         || coalesce(': ' || (select full_name from public.student where id = r.student_id), '');
  if r.status = 'pending' then
    for v_staff in select * from public.relax_step_staff(p_id) loop
      perform public.notify_safe(r.school_id, 'relaxation_waiting', 'relax:' || r.id || ':' || r.step || ':' || v_staff, null, v_staff, null,
        jsonb_build_object('request', r.id), 'Waiting for your approval', v_what, '/dashboard/relaxations');
    end loop;
  else
    select m.staff_id into v_req from public.person_membership m where m.user_id = r.requested_by and m.school_id = r.school_id and m.staff_id is not null limit 1;
    if v_req is not null then
      perform public.notify_safe(r.school_id, 'relaxation_decided', 'relax:' || r.id || ':' || r.status, null, v_req, null,
        jsonb_build_object('request', r.id), v_what || ': ' || r.status, r.reason, '/dashboard/relaxations');
    end if;
  end if;
end $$;
revoke all on function public.relax_notify(bigint) from public, anon, authenticated;

-- who may ask: the course teacher or class teacher for attendance, the teacher for unlock,
-- the office for fees. The office (exam cell) or principal may also approve at once ("override").
drop function if exists public.request_relaxation(text, bigint, bigint, bigint, date, date, text);
create function public.request_relaxation(p_kind text, p_student bigint, p_subject bigint, p_section bigint, p_date date, p_until date, p_reason text, p_override boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_id bigint; v_pct numeric; v_chain text[]; v_sec bigint;
begin
  select * into sc from public.school where id = v_school;
  if not public.is_higher_ed(v_school) then raise exception 'For colleges and universities'; end if;
  if app.my_staff_id() is null then raise exception 'Only staff can ask for a relaxation'; end if;
  if p_override and not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can approve directly'; end if;
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then raise exception 'No current semester'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  select array_agg(x) into v_chain from jsonb_array_elements_text(coalesce(sc.relax_chain -> p_kind, '["head"]'::jsonb)) x;
  if p_kind = 'unlock' then
    if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, s.academic_year_id)
            or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
      raise exception 'Only the teacher of this course can ask';
    end if;
    if public.lecture_lock_reason(p_section, p_subject, p_date) is null then raise exception 'This day is not locked'; end if;
    insert into public.relaxation_request (kind, semester_id, subject_id, section_id, on_date, reason, chain)
    values ('unlock', s.id, p_subject, p_section, p_date, left(trim(p_reason), 300), v_chain) returning id into v_id;
  elsif p_kind in ('attendance', 'fees') then
    v_sec := public.section_in_semester(p_student, s.id);
    if v_sec is null or not exists (select 1 from public.student where id = p_student and school_id = v_school) then raise exception 'Unknown student'; end if;
    if p_kind = 'attendance' then
      if p_subject is null then raise exception 'Choose the course'; end if;
      if not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(v_sec, s.academic_year_id)
              or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = v_sec and ta.subject_id = p_subject and ta.academic_year_id = s.academic_year_id)) then
        raise exception 'Only the course teacher, the class teacher or the office can ask';
      end if;
      select round(100.0 * count(*) filter (where a.status in ('present', 'late')) / nullif(count(*), 0), 1) into v_pct
        from public.attendance_record a where a.student_id = p_student and a.subject_id = p_subject and a.period is not null
         and a.on_date between s.starts_on and coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on);
      if v_pct is null or v_pct >= sc.attendance_minimum then raise exception 'Attendance in this course is not short'; end if;
      if sc.condone_floor is not null and v_pct < sc.condone_floor then
        raise exception 'Attendance is % %%, below % %%: it cannot be relaxed', v_pct, sc.condone_floor;
      end if;
    else
      if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office can ask for a fee extension'; end if;
      if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date or p_until > (now() at time zone 'Asia/Kolkata')::date + 120 then
        raise exception 'Give the date by which the fees will be paid (within 120 days)';
      end if;
    end if;
    insert into public.relaxation_request (kind, semester_id, student_id, subject_id, until, reason, chain)
    values (p_kind, s.id, p_student, case when p_kind = 'attendance' then p_subject end, case when p_kind = 'fees' then p_until end, left(trim(p_reason), 300), v_chain)
    returning id into v_id;
  else
    raise exception 'Unknown request';
  end if;
  if p_override then
    insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
    values (v_school, v_id, 1, 'override', app.my_staff_id(), 'approved', 'Approved directly');
    perform public.relax_apply(v_id);
  else
    perform public.relax_notify(v_id);
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting for approval';
end $$;

-- an approved request takes effect
create or replace function public.relax_apply(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  update public.relaxation_request set status = 'approved', step = array_length(chain, 1), decided_at = now(),
    until = case when kind = 'unlock' then (now() at time zone 'Asia/Kolkata')::date + 2 else until end
   where id = p_id returning * into r;
  if r.kind = 'attendance' then
    insert into public.attendance_condonation (school_id, semester_id, student_id, subject_id, reason, approved_by)
    values (r.school_id, r.semester_id, r.student_id, r.subject_id, left(r.reason, 200), app.my_staff_id())
    on conflict (semester_id, student_id, subject_id) do nothing;
  end if;
  perform public.relax_notify(p_id);
end $$;
revoke all on function public.relax_apply(bigint) from public, anon, authenticated;
revoke all on function public.request_relaxation(text, bigint, bigint, bigint, date, date, text, boolean) from public, anon;
grant execute on function public.request_relaxation(text, bigint, bigint, bigint, date, date, text, boolean) to authenticated;

-- each step in order; never by the person who asked; the principal acts on "head" steps
create or replace function public.relax_can_act(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r public.relaxation_request; t text; v_year bigint; v_sec bigint;
begin
  select * into r from public.relaxation_request where id = p_id and school_id = public.current_school_id();
  if r.id is null or r.status <> 'pending' or r.requested_by = auth.uid() then return false; end if;
  t := r.chain[r.step + 1];
  select academic_year_id into v_year from public.semester where id = r.semester_id;
  v_sec := coalesce(r.section_id, public.section_in_semester(r.student_id, r.semester_id));
  return case t when 'advisor' then coalesce(app.ct_of_section(v_sec, v_year), false)
                when 'office' then coalesce(app.is_office(), false)
                when 'head' then coalesce(app.is_principal(), false)
                else false end;
end $$;

create or replace function public.decide_relaxation(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  select * into r from public.relaxation_request where id = p_id and school_id = public.current_school_id() for update;
  if not public.relax_can_act(p_id) then raise exception 'This request is not waiting for you'; end if;
  insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
  values (r.school_id, r.id, r.step + 1, r.chain[r.step + 1], app.my_staff_id(), case when p_approve then 'approved' else 'rejected' end, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  if not p_approve then
    update public.relaxation_request set status = 'rejected', decided_at = now() where id = r.id;
    perform public.relax_notify(r.id);
    return 'rejected';
  end if;
  if r.step + 1 >= array_length(r.chain, 1) then
    perform public.relax_apply(r.id);
    return 'approved';
  end if;
  update public.relaxation_request set step = r.step + 1 where id = r.id;
  perform public.relax_notify(r.id);
  return 'next';
end $$;

-- the office or principal withdraws an approved relaxation
create or replace function public.revoke_relaxation(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.relaxation_request;
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can withdraw'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Give the reason'; end if;
  update public.relaxation_request set status = 'revoked', decided_at = now()
   where id = p_id and status = 'approved' and school_id = public.current_school_id() returning * into r;
  if r.id is null then raise exception 'Only an approved request can be withdrawn'; end if;
  insert into public.relaxation_step (school_id, request_id, step_no, as_type, staff_id, decision, note)
  values (r.school_id, r.id, 99, 'revoke', app.my_staff_id(), 'rejected', left(trim(p_reason), 300));
  if r.kind = 'attendance' then
    delete from public.attendance_condonation where semester_id = r.semester_id and student_id = r.student_id and subject_id = r.subject_id;
  end if;
end $$;
revoke all on function public.revoke_relaxation(bigint, text) from public, anon;
grant execute on function public.revoke_relaxation(bigint, text) to authenticated;

-- requests waiting for the caller
create or replace function public.my_relaxation_queue() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select r.id from public.relaxation_request r where r.school_id = public.current_school_id() and r.status = 'pending' and public.relax_can_act(r.id);
$$;
grant execute on function public.my_relaxation_queue() to authenticated;

-- who sees requests: the office and principal, the person who asked, those who
-- decided or can decide a step, the class teacher; families only their own attendance requests
drop policy if exists rr_read on public.relaxation_request;
create policy rr_read on public.relaxation_request for select to authenticated using (
  (select app.is_admin_scope()) or requested_by = (select auth.uid())
  or ((select app.my_staff_id()) is not null and (
        exists (select 1 from public.relaxation_step st where st.request_id = id and st.staff_id = (select app.my_staff_id()))
        or public.relax_can_act(id)
        or (student_id is not null and kind = 'attendance' and app.ct_of_section(public.section_in_semester(student_id, semester_id), null))))
  or (kind = 'attendance' and student_id is not null and app.owns_student(student_id)));
drop policy if exists rs_read on public.relaxation_step;
create policy rs_read on public.relaxation_step for select to authenticated
  using ((select app.my_staff_id()) is not null and exists (select 1 from public.relaxation_request r where r.id = request_id));

-- held students this semester (the detention list): office/principal all, class teacher their sections
create or replace function public.current_holds(p_section bigint default null)
returns table (student_id bigint, student_name text, admission_no text, section_label text, kind text, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  select * into sc from public.school where id = v_school;
  if s.id is null or app.my_staff_id() is null then return; end if;
  return query
  select x.sid, x.full_name, x.admission_no, x.lbl, x.k, x.why from (
    select st.id sid, st.full_name, st.admission_no, c.name || '-' || sec.name lbl, e.section_id,
      public.attendance_shortage(st.id, s.id) short,
      case when public.fee_relaxed(st.id, v_today) then 0 else public.overdue_fees(st.id, v_today) end bal
    from public.student_enrollment e join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    where e.academic_year_id = s.academic_year_id and e.status = 'active' and e.school_id = v_school
      and (p_section is null or e.section_id = p_section)
      and (coalesce(app.is_admin_scope(), false) or app.ct_of_section(e.section_id, s.academic_year_id))) y
  cross join lateral (values
    (y.sid, y.full_name, y.admission_no, y.lbl, 'attendance', 'Below ' || sc.attendance_minimum || '% in ' || y.short, y.short is not null),
    (y.sid, y.full_name, y.admission_no, y.lbl, 'fees', 'Fees overdue: Rs ' || to_char(y.bal, 'FM99,99,99,990.00'), y.bal > 0 and coalesce(app.is_admin_scope(), false))
  ) x(sid, full_name, admission_no, lbl, k, why, on_)
  where x.on_
  order by x.lbl, x.full_name, x.k;
end $$;
grant execute on function public.current_holds(bigint) to authenticated;

-- a student or parent sees why their own results are held
create or replace function public.my_result_holds(p_student bigint)
returns table (semester_id bigint, semester_no smallint, reason text)
language sql stable security definer set search_path = '' as $$
  select sr.semester_id, sr.semester_no, public.result_hold_reason(sr.student_id, sr.semester_id)
  from public.semester_result sr
  where sr.student_id = p_student and sr.school_id = public.current_school_id() and app.owns_student(p_student)
    and public.result_hold_reason(sr.student_id, sr.semester_id) is not null;
$$;
grant execute on function public.my_result_holds(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
