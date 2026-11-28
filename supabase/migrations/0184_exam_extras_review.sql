-- Exam extras after review: photocopy files checked against the student's own folder, fee and replacement,
-- who may open a scan (logged), accommodations and rates changed by leads only, revaluation counted from the photocopy,
-- duties already past kept, supplementary import only for courses not passed and never twice, withheld results.
begin;
-- the storage folder of an institution, exactly as the app builds it
create or replace function public.tenant_prefix(p_school bigint) returns text
language sql stable security definer set search_path = '' as $$
  select case when u.slug is not null
    then 'universities/' || left(trim(both '-' from regexp_replace(lower(u.slug), '[^a-z0-9._-]+', '-', 'g')), 80) || '/campuses/' || left(trim(both '-' from regexp_replace(lower(s.slug), '[^a-z0-9._-]+', '-', 'g')), 80)
    else 'schools/' || left(trim(both '-' from regexp_replace(lower(coalesce(s.slug, 'school-' || s.id)), '[^a-z0-9._-]+', '-', 'g')), 80) end
  from public.school s left join public.university u on u.id = s.university_id where s.id = p_school;
$$;
revoke all on function public.tenant_prefix(bigint) from public, anon, authenticated;

-- a photocopy: the fee paid, the file in this student's own folder; a wrong scan can be replaced; the student is told
create or replace function public.supply_photocopy(p_id bigint, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reval_request;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can supply a photocopy'; end if;
  select * into r from public.reval_request where id = p_id and school_id = public.current_school_id() and kind = 'photocopy' for update;
  if r.id is null or r.status not in ('requested', 'supplied') then raise exception 'No photocopy request waiting'; end if;
  if r.status = 'supplied' and not app.is_exams_lead() then raise exception 'Only the Controller of Examinations can replace a supplied copy'; end if;
  if r.invoice_id is not null and exists (select 1 from public.fee_invoice i where i.id = r.invoice_id and i.status in ('due', 'part')) then raise exception 'The fee is not paid yet'; end if;
  if p_key is null or p_key !~ ('^' || regexp_replace(public.tenant_prefix(r.school_id), '([.])', '\\\1', 'g') || '/students/' || r.student_id || '/scripts/[0-9a-f-]{36}\.(pdf|png|jpg)$') then
    raise exception 'Bad file';
  end if;
  update public.reval_request set status = 'supplied', file_key = p_key, decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
  perform public.notify_family(r.school_id, 'revaluation_decided', 'photocopy:' || r.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'), r.student_id, jsonb_build_object(),
    'Photocopy of the answer script', 'The photocopy of your answer script is ready on the Results page. You may ask for revaluation within the set days from today.', '/dashboard/results');
end $$;
revoke all on function public.supply_photocopy(bigint, text) from public, anon;
grant execute on function public.supply_photocopy(bigint, text) to authenticated;

-- who may open a scan: the student or family, and the exam cell's leads; every opening is logged
create or replace function public.photocopy_key(p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.reval_request;
begin
  select * into r from public.reval_request where id = p_id and school_id = public.current_school_id() and kind = 'photocopy' and status = 'supplied';
  if r.id is null then raise exception 'Not available'; end if;
  if not (app.owns_student(r.student_id) or app.is_exams_lead()) then raise exception 'Not allowed'; end if;
  if r.file_key !~ ('^' || regexp_replace(public.tenant_prefix(r.school_id), '([.])', '\\\1', 'g') || '/students/' || r.student_id || '/scripts/') then raise exception 'Not available'; end if;
  insert into public.audit_log (school_id, actor_id, actor_name, action, entity, entity_id, label, fields)
  values (r.school_id, auth.uid(), (select full_name from public.profile where id = auth.uid()), 'download', 'script_photocopy', r.id::text, null, '{}');
  return r.file_key;
end $$;
revoke all on function public.photocopy_key(bigint) from public, anon;
grant execute on function public.photocopy_key(bigint) to authenticated;
create or replace function public.photocopy_upload_ok(p_id bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select r.student_id from public.reval_request r where r.id = p_id and r.school_id = public.current_school_id() and r.kind = 'photocopy'
    and (r.status = 'requested' or (r.status = 'supplied' and app.is_exams_lead())) and app.is_exams();
$$;
revoke all on function public.photocopy_upload_ok(bigint) from public, anon;
grant execute on function public.photocopy_upload_ok(bigint) to authenticated;

-- accommodations and rates: the exam cell reads them, its leads change them
do $$ declare t text;
begin
  foreach t in array array['exam_accommodation', 'exam_rate'] loop
    execute format('drop policy if exists ex_rw on public.%I', t);
    execute format('drop policy if exists ex_read on public.%I', t);
    execute format('drop policy if exists ex_write on public.%I', t);
    execute format('create policy ex_read on public.%I for select to authenticated using ((select app.is_exams()))', t);
    execute format('create policy ex_write on public.%I for all to authenticated using ((select app.is_exams_lead())) with check ((select app.is_exams_lead()))', t);
  end loop;
end $$;
create or replace function public.exam_accommodation_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.student where id = new.student_id and school_id = new.school_id) then raise exception 'Unknown student'; end if;
  if new.session_id is not null and not exists (select 1 from public.exam_session where id = new.session_id and school_id = new.school_id) then raise exception 'Unknown exam'; end if;
  return new;
end $$;
drop trigger if exists trg_exam_accommodation_guard on public.exam_accommodation;
create trigger trg_exam_accommodation_guard before insert or update on public.exam_accommodation for each row execute function public.exam_accommodation_guard();

create or replace function public.decide_revaluation(p_id bigint, p_new_ese numeric, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.reval_request; cr public.course_result; v_scheme bigint; g record;
begin
  if exists (select 1 from public.reval_request x where x.id = p_id and x.kind = 'photocopy') then raise exception 'A photocopy is supplied, not decided'; end if;
  if not app.can_publish_results() then raise exception 'Revaluation is decided by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into r from public.reval_request where id = p_id and school_id = public.current_school_id() for update;
  if r.id is null or r.status <> 'requested' then raise exception 'This request is not waiting'; end if;
  if r.invoice_id is not null and exists (select 1 from public.fee_invoice i where i.id = r.invoice_id and i.status in ('due', 'part')) then raise exception 'The fee is not paid yet'; end if;
  select * into cr from public.course_result where id = r.result_id for update;
  if p_new_ese is null or p_new_ese = cr.ese then
    update public.reval_request set status = 'no_change', new_ese = cr.ese, new_grade = cr.grade, note = left(p_note, 300), decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
    perform public.notify_family(cr.school_id, 'revaluation_decided', 'reval:' || r.id, cr.student_id, jsonb_build_object('request', r.id),
      initcap(r.kind) || ' result', (select code from public.course where id = cr.course_id) || ': no change', '/dashboard/results');
    return 'no_change';
  end if;
  if p_new_ese < 0 or p_new_ese > coalesce(cr.ese_max, 0) then raise exception 'Marks must be between 0 and %', cr.ese_max; end if;
  if cr.attempt > 1 then raise exception 'Revaluation is for the first attempt'; end if;
  select p.eval_scheme_id into v_scheme from public.student_enrollment e join public.semester s on s.id = cr.semester_id and s.academic_year_id = e.academic_year_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id
   where e.student_id = cr.student_id order by (e.status = 'active') desc limit 1;
  if v_scheme is null then raise exception 'The programme has no evaluation scheme'; end if;
  select * into g from public.grade_course(v_scheme, cr.cia, cr.cia_max, p_new_ese, cr.ese_max, false);
  insert into public.course_result_revision (school_id, revised_by, reason, old) values (cr.school_id, app.my_staff_id(), left(initcap(r.kind) || ' #' || r.id, 200), to_jsonb(cr));
  update public.course_result set ese = p_new_ese, percent = g.percent, grade = g.grade, point = g.point, passed = g.passed, grace = null where id = cr.id;
  update public.reval_request set status = 'revised', new_ese = p_new_ese, new_grade = g.grade, note = left(p_note, 300), decided_by = app.my_staff_id(), decided_at = now() where id = r.id;
  -- grace still applies to a revalued course, the semester line and CGPA follow
  perform public.apply_grace(cr.semester_id, array[cr.student_id]);
  perform public.refresh_semester_line(cr.student_id, cr.semester_id);
  perform public.refresh_cgpa(array[cr.student_id]);
  -- passed on revaluation: a pending supplementary registration for the course is no longer needed
  if not cr.passed and (select passed from public.course_result where id = cr.id) then
    perform public.withdraw_supp(x.id) from public.supp_registration x where x.student_id = cr.student_id and x.course_id = cr.course_id and x.status = 'registered';
  end if;
  update public.reval_request set new_grade = (select grade from public.course_result where id = cr.id) where id = r.id;
  perform public.notify_family(cr.school_id, 'revaluation_decided', 'reval:' || r.id, cr.student_id, jsonb_build_object('request', r.id),
    initcap(r.kind) || ' result', (select code from public.course where id = cr.course_id) || ': ' || coalesce(r.old_grade, '') || ' to ' || coalesce((select grade from public.course_result where id = cr.id), ''), '/dashboard/results');
  return 'revised';
end $$;

create or replace function public.request_revaluation(p_result bigint, p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); cr public.course_result; sc public.school; v_fee numeric; v_inv bigint; v_id bigint; v_year bigint;
begin
  select * into cr from public.course_result where id = p_result and school_id = v_school;
  if cr.id is null then raise exception 'Unknown result'; end if;
  if p_kind not in ('revaluation', 'retotalling', 'photocopy') then raise exception 'Choose revaluation, retotalling or a photocopy'; end if;
  if not (app.owns_student(cr.student_id) or app.is_exams()) then raise exception 'Not allowed'; end if;
  if cr.grade = 'Ab' then raise exception 'There is no answer script to revalue (absent)'; end if;
  if cr.attempt > 1 then raise exception 'Revaluation is for the first attempt; ask the exam cell about re-takes'; end if;
  if exists (select 1 from public.reval_request x where x.result_id = cr.id and x.kind = p_kind and x.status <> 'withdrawn') then
    raise exception 'A % has already been asked for this course', p_kind;
  end if;
  if public.result_hold(cr.student_id, cr.semester_id) is not null and not app.is_exams() then raise exception 'This result is held back'; end if;
  select * into sc from public.school where id = v_school;
  if not app.is_exams() and greatest((cr.published_at at time zone 'Asia/Kolkata')::date,
       coalesce((select max((x.decided_at at time zone 'Asia/Kolkata')::date) from public.reval_request x where x.result_id = cr.id and x.kind = 'photocopy' and x.status = 'supplied'), '-infinity'::date))
       + sc.reval_window_days < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Requests closed % days after the results', sc.reval_window_days;
  end if;
  v_fee := case p_kind when 'revaluation' then sc.reval_fee when 'photocopy' then sc.photocopy_fee else sc.retotal_fee end;
  select id into v_year from public.academic_year where school_id = v_school and is_current;
  insert into public.reval_request (school_id, result_id, student_id, kind, old_ese, old_grade) values (v_school, cr.id, cr.student_id, p_kind, cr.ese, cr.grade)
  returning id into v_id;
  if coalesce(v_fee, 0) > 0 and v_year is not null then
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
    values (v_school, cr.student_id, public.section_in_semester(cr.student_id, (select id from public.semester where school_id = v_school and is_current)), v_year,
            left(initcap(p_kind) || ' fee: ' || (select code from public.course where id = cr.course_id) || ' #' || v_id, 80), v_fee, (now() at time zone 'Asia/Kolkata')::date + 7, 'due')
    returning id into v_inv;
    update public.reval_request set invoice_id = v_inv where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'This request is already waiting';
end $$;

create or replace function public.assign_duties(p_session bigint, p_per_room int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_pool bigint[]; v_avail bigint[]; v_per int := least(greatest(coalesce(p_per_room, 1), 1), 4);
  sl record; n int := 0; k int; v_short text[] := '{}'; v_off int := 0; v_end time;
begin
  if not app.is_exams() then raise exception 'Only the exam cell can assign duties'; end if;
  if not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  delete from public.exam_duty where session_id = p_session and exam_date >= (now() at time zone 'Asia/Kolkata')::date;
  -- exam-centre staff first, then teachers; fewest duties this year first
  select array_agg(x.id order by x.pri, x.load, x.id) into v_pool from (
    select st.id, case when exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)) then 0 else 1 end pri,
      (select count(*) from public.exam_duty d join public.exam_session es on es.id = d.session_id join public.academic_year y on y.id = es.academic_year_id and y.is_current where d.staff_id = st.id) load
    from public.staff st where st.school_id = v_school
      and (st.role in ('subject_teacher', 'class_teacher') or exists (select 1 from public.staff_position p join public.position_title t on t.id = p.title_id
                                    where p.staff_id = st.id and t.access_type = 'exam_centre' and (p.ends_on is null or p.ends_on >= current_date)))) x;
  if coalesce(cardinality(v_pool), 0) = 0 then raise exception 'There are no teachers to assign'; end if;
  for sl in select exam_date, starts_at, array_agg(distinct room_id) rooms from public.exam_seat where session_id = p_session and exam_date >= (now() at time zone 'Asia/Kolkata')::date group by 1, 2 order by 1, 2 loop
    select max(ends_at) into v_end from public.exam_paper where session_id = p_session and exam_date = sl.exam_date and starts_at = sl.starts_at;
    -- nobody already on duty in another exam at an overlapping time
    select array_agg(p order by i) into v_avail from unnest(v_pool) with ordinality u(p, i)
     where not exists (select 1 from public.staff_leave l where l.staff_id = u.p and l.status = 'approved' and sl.exam_date between l.from_date and l.to_date)
       and not exists (select 1 from public.exam_duty d join public.exam_paper op on op.session_id = d.session_id and op.exam_date = d.exam_date and op.starts_at = d.starts_at
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

drop function if exists public.import_university_results(bigint, jsonb, text);
create function public.import_university_results(p_semester bigint, p_rows jsonb, p_kind text default 'regular') returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_ids bigint[]; n int := 0; k int; v_bad text; v_m jsonb;
begin
  if not app.can_publish_results() then raise exception 'Results are imported by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  if p_kind not in ('regular', 'supplementary') then raise exception 'Choose regular or supplementary results'; end if;
  -- a row names the student by university register number or admission number
  select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'course_id', c.id, 'credits', c.credits, 'grade', case when upper(trim(r.grade)) = 'AB' then 'Ab' else nullif(trim(r.grade), '') end, 'point', case when upper(trim(r.grade)) in ('AB', 'WH') then 0 else coalesce(r.point, 0) end,
         'passed', case when upper(trim(r.grade)) in ('AB', 'WH', 'F', 'FF', 'RA', 'U', 'DT', 'FAIL', 'RE') then false else coalesce(r.passed, coalesce(r.point, 0) > 0) end, 'key', coalesce(nullif(trim(r.register_no), ''), trim(r.admission_no), '?') || '/' || coalesce(trim(r.course_code), '?'))), '[]')
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
  -- WH: the university withheld the result; nothing is written for that course, the semester line says so
  if p_kind = 'regular' then
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, backlogs, published_by, published_as, withheld_reason)
  select distinct v_school, p_semester, u.student_id, 0, 0, null::numeric, 0, app.my_staff_id(), 'Imported from the university', 'Withheld by the university'
  from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text) where upper(u.grade) = 'WH'
  on conflict (semester_id, student_id) do update set withheld_reason = coalesce(public.semester_result.withheld_reason, 'Withheld by the university');
  -- a real result for a student who was withheld by the university releases that hold
  update public.semester_result sr set withheld_reason = null
   where sr.semester_id = p_semester and sr.withheld_reason = 'Withheld by the university'
     and sr.student_id in (select (x ->> 'student_id')::bigint from jsonb_array_elements(v_m) x where upper(x ->> 'grade') <> 'WH')
     and sr.student_id not in (select (x ->> 'student_id')::bigint from jsonb_array_elements(v_m) x where upper(x ->> 'grade') = 'WH');
  end if;
  v_m := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_m) x where upper(x ->> 'grade') <> 'WH'), '[]');
  -- supplementary: a new attempt for each course (the earlier ones stay)
  if p_kind = 'supplementary' then
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed, kind)
    select v_school, p_semester, u.student_id, u.course_id,
           coalesce((select max(cr.attempt) from public.course_result cr where cr.student_id = u.student_id and cr.course_id = u.course_id), 0) + 1,
           u.credits, u.grade, case when u.passed then u.point else 0 end, u.passed, 'supplementary'
    from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
    -- only a course the student has not yet passed, and not the same supplementary result twice
    where exists (select 1 from public.course_result l where l.student_id = u.student_id and l.course_id = u.course_id)
      and not exists (select 1 from public.course_result l where l.student_id = u.student_id and l.course_id = u.course_id and l.passed)
      and not exists (select 1 from public.course_result l where l.student_id = u.student_id and l.course_id = u.course_id and l.kind = 'supplementary'
                      and l.grade = u.grade and l.semester_id = p_semester and l.published_at > now() - interval '30 days');
    get diagnostics n = row_count;
    update public.supp_registration sr set status = 'published' where sr.status = 'registered'
      and exists (select 1 from jsonb_to_recordset(v_m) as u(student_id bigint, course_id bigint, credits numeric, grade text, point numeric, passed boolean, key text)
                  where u.student_id = sr.student_id and u.course_id = sr.course_id);
    select coalesce(array_agg(distinct (x ->> 'student_id')::bigint), '{}') into v_ids from jsonb_array_elements(v_m) x;
    perform public.refresh_cgpa(v_ids);
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    values (v_school, 'results_published', p_semester, jsonb_build_object('students', to_jsonb(v_ids), 'revised', true));
    return n;
  end if;
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
revoke all on function public.import_university_results(bigint, jsonb, text) from public, anon;
grant execute on function public.import_university_results(bigint, jsonb, text) to authenticated;
commit;
notify pgrst, 'reload schema';
