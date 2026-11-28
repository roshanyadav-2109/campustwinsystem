-- After review of 0193: moderation and opening never let a missing id through; a paper's source is set only by
-- copying and an approved paper is moved only by those who run papers (the window follows the source paper); setter
-- names only for them; common exams listed for central administration; local and central allotment kept apart;
-- central evaluators are working teachers outside the confidential section; the file can't change under moderation.
begin;
create or replace function app.can_run_paper(p_school bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((p_school = public.current_school_id() and app.is_confidential()) or app.is_central_for(p_school), false);
$$;

create or replace function public.moderate_question_paper(p_qp bigint, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper;
begin
  select * into q from public.question_paper where id = p_qp for update;
  if q.id is null or (q.moderator_id is distinct from app.my_staff_id() and not app.can_run_paper(q.school_id)) or app.my_staff_id() is null and not app.can_run_paper(q.school_id) then raise exception 'Only the moderator can decide'; end if;
  if q.status <> 'submitted' then raise exception 'The paper is not waiting for moderation'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Say what should change'; end if;
  update public.question_paper set status = case when p_approve then 'approved' else 'returned' end, note = left(nullif(trim(p_note), ''), 500),
    approved_at = case when p_approve then now() end where id = q.id;
  if not p_approve then
    perform public.notify_safe((select school_id from public.staff where id = q.setter_id), 'announcement', 'qp-ret:' || q.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, q.setter_id, null, '{}'::jsonb,
      'Question paper sent back', 'The moderator has asked for changes to your question paper. See Question papers.', '/dashboard/question-papers');
  end if;
end $$;

create or replace function public.submit_question_paper(p_qp bigint, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper;
begin
  select * into q from public.question_paper where id = p_qp for update;
  if q.id is null or q.setter_id is distinct from app.my_staff_id() then raise exception 'Only the setter can submit this paper'; end if;
  if q.status not in ('assigned', 'returned') then raise exception 'The paper is with the moderator or approved; it cannot be replaced now'; end if;
  if p_key is null or left(p_key, length(public.tenant_prefix(q.school_id) || '/exams/question-papers/' || q.id || '/')) <> public.tenant_prefix(q.school_id) || '/exams/question-papers/' || q.id || '/'
     or substr(p_key, length(public.tenant_prefix(q.school_id) || '/exams/question-papers/' || q.id || '/') + 1) !~ '^[0-9a-f-]{36}\.(pdf|docx)$' then raise exception 'Upload the paper first'; end if;
  update public.question_paper set file_key = p_key, status = 'submitted', submitted_at = now(), note = null where id = q.id;
  if q.moderator_id is not null then
    perform public.notify_safe((select school_id from public.staff where id = q.moderator_id), 'announcement', 'qp-mod:' || q.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, q.moderator_id, null, '{}'::jsonb,
      'Question paper to moderate', 'A question paper is waiting for your moderation. See Question papers.', '/dashboard/question-papers');
  end if;
end $$;

create or replace function public.question_paper_upload_ok(p_qp bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select q.school_id from public.question_paper q where q.id = p_qp and q.setter_id = app.my_staff_id() and q.status in ('assigned', 'returned');
$$;

create or replace function public.question_paper_key(p_qp bigint, p_paper bigint default null) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper; p public.exam_paper; sp public.exam_paper; ok boolean := false; v_start timestamp; v_end timestamp;
begin
  select * into q from public.question_paper where id = p_qp;
  if q.id is null or q.file_key is null then return null; end if;
  if (app.my_staff_id() is not null and (q.setter_id = app.my_staff_id() or q.moderator_id is not distinct from app.my_staff_id())) or app.can_run_paper(q.school_id) then ok := true;
  elsif q.status = 'approved' and coalesce(app.is_exams(), false) then
    select * into p from public.exam_paper where id = coalesce(p_paper, q.paper_id) and school_id = public.current_school_id() and (id = q.paper_id or source_paper_id = q.paper_id);
    select * into sp from public.exam_paper where id = q.paper_id;
    if p.id is not null and sp.id is not null then
      v_start := sp.exam_date + sp.starts_at;
      v_end := v_start + coalesce(case when sp.ends_at > sp.starts_at then sp.ends_at - sp.starts_at end, interval '3 hours');
      ok := (now() at time zone 'Asia/Kolkata') between v_start - make_interval(mins => q.release_minutes) and v_end;
      if ok is not true then raise exception 'The paper opens % minutes before it starts (% at %)', q.release_minutes, to_char(sp.exam_date, 'DD Mon'), to_char(sp.starts_at, 'HH24:MI'); end if;
    end if;
  end if;
  if ok is not true then return null; end if;
  insert into public.question_paper_access (qp_id, school_id, by_user) values (q.id, public.current_school_id(), auth.uid());
  return q.file_key;
end $$;
revoke all on function public.question_paper_key(bigint, bigint) from public, anon;
grant execute on function public.question_paper_key(bigint, bigint) to authenticated;

create or replace function public.exam_paper_qp_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;  -- maintenance by the system itself
  if new.source_paper_id is distinct from (case when tg_op = 'UPDATE' then old.source_paper_id end) and coalesce(current_setting('app.copying', true), '') <> 'on' then
    raise exception 'The source of a paper is set only by copying a common exam';
  end if;
  if tg_op = 'UPDATE' and (new.exam_date, new.starts_at, new.ends_at) is distinct from (old.exam_date, old.starts_at, old.ends_at)
     and exists (select 1 from public.question_paper q where q.paper_id = old.id and q.status = 'approved') and not app.can_run_paper(old.school_id) then
    raise exception 'The question paper is approved; only the confidential section or central administration can move this paper';
  end if;
  return new;
end $$;
drop trigger if exists trg_exam_paper_qp_guard on public.exam_paper;
create trigger trg_exam_paper_qp_guard before insert or update on public.exam_paper for each row execute function public.exam_paper_qp_guard();

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
  perform set_config('app.copying', 'on', true);
  insert into public.exam_session (school_id, academic_year_id, name, term, assessment_type_id, instructions, withhold_fee_dues, kind, fee_per_course, paper_max, source_session_id)
  values (p_to, v_year, es.name, es.term, v_type, es.instructions, es.withhold_fee_dues, es.kind, es.fee_per_course, es.paper_max, p_session) returning id into v_new;
  with m as (
    select p.*, (select c2.id from public.class c1 join public.class c2 on c2.school_id = p_to and lower(c2.name) = lower(c1.name) where c1.id = p.class_id) to_class,
      (select coalesce(
         (select s2.id from public.subject s1 join public.course k1 on k1.id = s1.course_id join public.course k2 on k2.school_id = p_to and k2.code = k1.code join public.subject s2 on s2.course_id = k2.id where s1.id = p.subject_id limit 1),
         (select s2.id from public.subject s1 join public.subject s2 on s2.school_id = p_to and lower(s2.name) = lower(s1.name) where s1.id = p.subject_id limit 1))) to_subject
    from public.exam_paper p where p.session_id = p_session),
  ins as (insert into public.exam_paper (school_id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, component, source_paper_id)
          select p_to, v_new, m.to_class, m.to_subject, m.exam_date, m.starts_at, m.ends_at, m.max_marks, m.component, m.id from m
          where m.to_subject is not null and (m.class_id is null or m.to_class is not null) returning 1)
  select (select count(*) from ins), (select count(*) from m) - (select count(*) from ins) into n, v_skip;
  perform set_config('app.copying', 'off', true);
  return jsonb_build_object('session_id', v_new, 'papers', n, 'skipped', v_skip);
end $$;

create or replace function public.session_question_papers(p_session bigint)
returns table (paper_id bigint, subject text, class_name text, exam_date date, starts_at time, ends_at time, central boolean,
               qp_id bigint, setter_id bigint, setter text, moderator_id bigint, moderator text, status text, note text, release_minutes int, has_file boolean, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, sb.name, c.name, p.exam_date, p.starts_at, p.ends_at, p.source_paper_id is not null,
    q.id, case when app.can_run_paper(p.school_id) then q.setter_id end, case when app.can_run_paper(p.school_id) then st.full_name || ' (' || ss.name || ')' end,
    case when app.can_run_paper(p.school_id) then q.moderator_id end, case when app.can_run_paper(p.school_id) then mo.full_name end, q.status, q.note, q.release_minutes, q.file_key is not null,
    p.source_paper_id is null and app.can_run_paper(p.school_id)
  from public.exam_paper p join public.subject sb on sb.id = p.subject_id left join public.class c on c.id = p.class_id
  left join public.question_paper q on q.paper_id = coalesce(p.source_paper_id, p.id)
  left join public.staff st on st.id = q.setter_id left join public.school ss on ss.id = st.school_id
  left join public.staff mo on mo.id = q.moderator_id
  where p.session_id = p_session
    and (app.can_run_paper(p.school_id) or (p.school_id = public.current_school_id() and app.is_exams()))
  order by p.exam_date, p.starts_at, sb.name;
$$;

create or replace function public.common_exams()
returns table (id bigint, name text, copies int)
language sql stable security definer set search_path = '' as $$
  select es.id, es.name, (select count(*)::int from public.exam_session c where c.source_session_id = es.id)
  from public.exam_session es where es.school_id = public.current_school_id() and app.is_central_for(es.school_id)
    and exists (select 1 from public.exam_session c where c.source_session_id = es.id)
  order by es.created_at desc limit 30;
$$;
revoke all on function public.common_exams() from public, anon;
grant execute on function public.common_exams() to authenticated;

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
  from (select es.id, row_number() over (order by es.code) k from public.exam_script es where es.paper_id = p_paper and es.status = 'pending'
          and (es.evaluator_id is null or exists (select 1 from public.staff o where o.id = es.evaluator_id and o.school_id = es.school_id))) y
  where x.id = y.id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.central_allot(p_paper bigint, p_staff bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare sp public.exam_paper; n int;
begin
  select * into sp from public.exam_paper where id = p_paper and source_paper_id is null;
  if sp.id is null or not app.is_central_for(sp.school_id) then raise exception 'Only central administration can allot scripts across campuses'; end if;
  if coalesce(cardinality(p_staff), 0) = 0 then raise exception 'Choose the evaluators'; end if;
  if exists (select 1 from unnest(p_staff) e where not app.paper_staff_ok(sp.school_id, e)) then raise exception 'Choose staff of the university''s campuses'; end if;
  if exists (select 1 from unnest(p_staff) e join public.staff s on s.id = e where s.role not in ('subject_teacher', 'class_teacher', 'principal') or (s.left_on is not null and s.left_on <= (now() at time zone 'Asia/Kolkata')::date)
             or exists (select 1 from public.staff_position x join public.position_title t on t.id = x.title_id where x.staff_id = e and t.access_type in ('confidential', 'exams_head') and (x.ends_on is null or x.ends_on >= current_date))) then
    raise exception 'Choose teachers still working, not the confidential section or the exam heads';
  end if;
  with ev as (select e.id, s.school_id, row_number() over (order by e.ord) - 1 k from unnest(p_staff) with ordinality e(id, ord) join public.staff s on s.id = e.id),
  sc as (select x.id, x.school_id, row_number() over (partition by x.school_id order by x.code) - 1 r
         from public.exam_script x join public.exam_paper p on p.id = x.paper_id
         where (p.id = sp.id or p.source_paper_id = sp.id) and x.evaluator_id is null and not x.is_absent and x.status = 'pending'),
  pick as (select sc.id, coalesce(
             (select o.id from (select ev.id, row_number() over (order by ev.k) - 1 j, count(*) over () m from ev where ev.school_id <> sc.school_id) o where o.j = sc.r % o.m),
             (select ev.id from ev where ev.k = sc.r % (select count(*) from ev))) evaluator
           from sc),
  upd as (update public.exam_script x set evaluator_id = pick.evaluator from pick where x.id = pick.id returning 1)
  select count(*) into n from upd;
  return n;
end $$;
commit;
notify pgrst, 'reload schema';
