-- Question papers and central valuation.
--   Question papers: the confidential section (or central administration for a university's common exam) names a
--   setter and a moderator for each paper; the setter uploads the paper privately; the moderator approves it or
--   sends it back with a note. The exam cell of the institution, and of each campus that copied a common exam, can
--   open the approved paper only from a set time before the paper starts until it ends; every opening is logged.
--   Central valuation: each campus still codes its own scripts (only it can decode names); central administration
--   sends the coded scripts of every campus to evaluators from any campus, preferring one from another campus.
begin;

-- each copied paper remembers the paper it came from
alter table public.exam_paper add column if not exists source_paper_id bigint references public.exam_paper(id) on delete set null;
update public.exam_paper cp set source_paper_id = sp.id
from public.exam_session cs, public.exam_paper sp, public.subject cps, public.subject ss
where cp.source_paper_id is null and cp.session_id = cs.id and cs.source_session_id is not null and sp.session_id = cs.source_session_id
  and cps.id = cp.subject_id and ss.id = sp.subject_id and lower(cps.name) = lower(ss.name) and sp.component = cp.component
  and ((cp.class_id is null and sp.class_id is null) or exists (select 1 from public.class a, public.class b where a.id = cp.class_id and b.id = sp.class_id and lower(a.name) = lower(b.name)));
create index if not exists idx_exam_paper_source on public.exam_paper (source_paper_id) where source_paper_id is not null;

-- ---------- question papers ----------
create table if not exists public.question_paper (
  id            bigint generated always as identity primary key,
  school_id     bigint not null references public.school(id) on delete cascade,
  paper_id      bigint not null unique references public.exam_paper(id) on delete cascade,
  setter_id     bigint not null references public.staff(id) on delete restrict,
  moderator_id  bigint references public.staff(id) on delete set null,
  status        text not null default 'assigned' check (status in ('assigned', 'submitted', 'returned', 'approved')),
  file_key      text,
  note          text check (note is null or char_length(note) <= 500),
  release_minutes int not null default 60 check (release_minutes between 10 and 1440),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.question_paper enable row level security;
revoke all on public.question_paper from anon, authenticated;
grant all on public.question_paper to service_role;
-- (read and written only through the functions below)

create table if not exists public.question_paper_access (
  id         bigint generated always as identity primary key,
  qp_id      bigint not null references public.question_paper(id) on delete cascade,
  school_id  bigint references public.school(id) on delete set null,
  by_user    uuid,
  at         timestamptz not null default now()
);
alter table public.question_paper_access enable row level security;
revoke all on public.question_paper_access from anon, authenticated;
grant all on public.question_paper_access to service_role;

-- staff who may set, moderate or value for a paper's institution: its own staff, or any campus of its university
create or replace function app.paper_staff_ok(p_school bigint, p_staff bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s join public.school a on a.id = s.school_id join public.school b on b.id = p_school
                 where s.id = p_staff and (s.school_id = p_school or (a.university_id is not null and a.university_id = b.university_id)));
$$;
revoke all on function app.paper_staff_ok(bigint, bigint) from public, anon;
grant execute on function app.paper_staff_ok(bigint, bigint) to authenticated;

-- who runs question papers for a paper: its confidential section, or central administration
create or replace function app.can_run_paper(p_school bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_school = public.current_school_id() and app.is_confidential()) or app.is_central_for(p_school);
$$;
revoke all on function app.can_run_paper(bigint) from public, anon;
grant execute on function app.can_run_paper(bigint) to authenticated;

create or replace function public.assign_question_setter(p_paper bigint, p_setter bigint, p_moderator bigint, p_release int default 60) returns bigint
language plpgsql security definer set search_path = '' as $$
declare p public.exam_paper; v_id bigint; v_old bigint;
begin
  select * into p from public.exam_paper where id = p_paper;
  if p.id is null or not app.can_run_paper(p.school_id) then raise exception 'Only the confidential section or central administration can name setters'; end if;
  if p.source_paper_id is not null then raise exception 'This paper comes from the university''s common exam; its question paper is set centrally'; end if;
  if not app.paper_staff_ok(p.school_id, p_setter) or (p_moderator is not null and not app.paper_staff_ok(p.school_id, p_moderator)) then raise exception 'Choose staff of this institution or its university'; end if;
  if p_moderator = p_setter then raise exception 'The moderator must be someone other than the setter'; end if;
  select id, setter_id into v_id, v_old from public.question_paper where paper_id = p_paper;
  if v_id is null then
    insert into public.question_paper (school_id, paper_id, setter_id, moderator_id, release_minutes) values (p.school_id, p_paper, p_setter, p_moderator, greatest(least(coalesce(p_release, 60), 1440), 10)) returning id into v_id;
  else
    if exists (select 1 from public.question_paper where id = v_id and status = 'approved') and v_old <> p_setter then raise exception 'The paper is approved; it cannot be given to another setter'; end if;
    update public.question_paper set setter_id = p_setter, moderator_id = p_moderator, release_minutes = greatest(least(coalesce(p_release, 60), 1440), 10),
      status = case when setter_id <> p_setter then 'assigned' else status end, file_key = case when setter_id <> p_setter then null else file_key end where id = v_id;
  end if;
  if v_old is distinct from p_setter then
    perform public.notify_safe((select school_id from public.staff where id = p_setter), 'announcement', 'qp-set:' || v_id || ':' || p_setter, null, p_setter, null, '{}'::jsonb,
      'Question paper to set', 'You have been asked to set a question paper. See Question papers.', '/dashboard/question-papers');
  end if;
  return v_id;
end $$;
revoke all on function public.assign_question_setter(bigint, bigint, bigint, int) from public, anon;
grant execute on function public.assign_question_setter(bigint, bigint, bigint, int) to authenticated;

-- the papers of an exam with their question paper state (for the confidential section / central administration,
-- and the exam cell of a campus that copied the exam: read only)
create or replace function public.session_question_papers(p_session bigint)
returns table (paper_id bigint, subject text, class_name text, exam_date date, starts_at time, ends_at time, central boolean,
               qp_id bigint, setter_id bigint, setter text, moderator_id bigint, moderator text, status text, note text, release_minutes int, has_file boolean, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, sb.name, c.name, p.exam_date, p.starts_at, p.ends_at, p.source_paper_id is not null,
    q.id, q.setter_id, st.full_name || ' (' || ss.name || ')', q.moderator_id, mo.full_name, q.status, q.note, q.release_minutes, q.file_key is not null,
    p.source_paper_id is null and app.can_run_paper(p.school_id)
  from public.exam_paper p join public.subject sb on sb.id = p.subject_id left join public.class c on c.id = p.class_id
  left join public.question_paper q on q.paper_id = coalesce(p.source_paper_id, p.id)
  left join public.staff st on st.id = q.setter_id left join public.school ss on ss.id = st.school_id
  left join public.staff mo on mo.id = q.moderator_id
  where p.session_id = p_session
    and (app.can_run_paper(p.school_id) or (p.school_id = public.current_school_id() and app.is_exams()))
  order by p.exam_date, p.starts_at, sb.name;
$$;
revoke all on function public.session_question_papers(bigint) from public, anon;
grant execute on function public.session_question_papers(bigint) to authenticated;

-- papers the signed-in teacher sets or moderates
create or replace function public.my_question_papers()
returns table (qp_id bigint, role text, institution text, exam text, subject text, class_name text, exam_date date, status text, note text, has_file boolean)
language sql stable security definer set search_path = '' as $$
  select q.id, case when q.setter_id = app.my_staff_id() then 'setter' else 'moderator' end, sc.name, es.name, sb.name, c.name, p.exam_date, q.status, q.note, q.file_key is not null
  from public.question_paper q join public.exam_paper p on p.id = q.paper_id join public.exam_session es on es.id = p.session_id
  join public.subject sb on sb.id = p.subject_id left join public.class c on c.id = p.class_id join public.school sc on sc.id = q.school_id
  where app.my_staff_id() is not null and (q.setter_id = app.my_staff_id() or (q.moderator_id = app.my_staff_id() and q.status in ('submitted', 'approved', 'returned')))
  order by p.exam_date;
$$;
revoke all on function public.my_question_papers() from public, anon;
grant execute on function public.my_question_papers() to authenticated;

-- the setter may upload while the paper is not approved; returns the institution whose folder holds it
create or replace function public.question_paper_upload_ok(p_qp bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select q.school_id from public.question_paper q where q.id = p_qp and q.setter_id = app.my_staff_id() and q.status in ('assigned', 'returned', 'submitted');
$$;
revoke all on function public.question_paper_upload_ok(bigint) from public, anon;
grant execute on function public.question_paper_upload_ok(bigint) to authenticated;

create or replace function public.submit_question_paper(p_qp bigint, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper;
begin
  select * into q from public.question_paper where id = p_qp for update;
  if q.id is null or q.setter_id is distinct from app.my_staff_id() then raise exception 'Only the setter can submit this paper'; end if;
  if q.status = 'approved' then raise exception 'The paper is already approved'; end if;
  if p_key is null or p_key not like public.tenant_prefix(q.school_id) || '/exams/question-papers/' || q.id || '/%' then raise exception 'Upload the paper first'; end if;
  update public.question_paper set file_key = p_key, status = 'submitted', submitted_at = now(), note = null where id = q.id;
  if q.moderator_id is not null then
    perform public.notify_safe((select school_id from public.staff where id = q.moderator_id), 'announcement', 'qp-mod:' || q.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, q.moderator_id, null, '{}'::jsonb,
      'Question paper to moderate', 'A question paper is waiting for your moderation. See Question papers.', '/dashboard/question-papers');
  end if;
end $$;
revoke all on function public.submit_question_paper(bigint, text) from public, anon;
grant execute on function public.submit_question_paper(bigint, text) to authenticated;

create or replace function public.moderate_question_paper(p_qp bigint, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper;
begin
  select * into q from public.question_paper where id = p_qp for update;
  if q.id is null or not (q.moderator_id = app.my_staff_id() or app.can_run_paper(q.school_id)) then raise exception 'Only the moderator can decide'; end if;
  if q.status <> 'submitted' then raise exception 'The paper is not waiting for moderation'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Say what should change'; end if;
  update public.question_paper set status = case when p_approve then 'approved' else 'returned' end, note = left(nullif(trim(p_note), ''), 500),
    approved_at = case when p_approve then now() end where id = q.id;
  if not p_approve then
    perform public.notify_safe((select school_id from public.staff where id = q.setter_id), 'announcement', 'qp-ret:' || q.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, q.setter_id, null, '{}'::jsonb,
      'Question paper sent back', 'The moderator has asked for changes to your question paper. See Question papers.', '/dashboard/question-papers');
  end if;
end $$;
revoke all on function public.moderate_question_paper(bigint, boolean, text) from public, anon;
grant execute on function public.moderate_question_paper(bigint, boolean, text) to authenticated;

-- the file key, for one who may open it now; each opening is logged.
--   setter and moderator: their own paper; confidential section / central administration: any time;
--   the exam cell of the institution or of a campus with a copy: the approved paper, from release_minutes before
--   the start until the end of that day's paper.
create or replace function public.question_paper_key(p_qp bigint, p_paper bigint default null) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.question_paper; p public.exam_paper; ok boolean := false; v_start timestamp;
begin
  select * into q from public.question_paper where id = p_qp;
  if q.id is null or q.file_key is null then return null; end if;
  if q.setter_id = app.my_staff_id() or q.moderator_id = app.my_staff_id() or app.can_run_paper(q.school_id) then ok := true;
  elsif q.status = 'approved' and app.is_exams() then
    select * into p from public.exam_paper where id = coalesce(p_paper, q.paper_id) and school_id = public.current_school_id() and (id = q.paper_id or source_paper_id = q.paper_id);
    if p.id is not null then
      v_start := p.exam_date + p.starts_at;
      ok := (now() at time zone 'Asia/Kolkata') between v_start - make_interval(mins => q.release_minutes) and p.exam_date + coalesce(p.ends_at, p.starts_at + interval '3 hours');
      if not ok then raise exception 'The paper opens % minutes before it starts (% at %)', q.release_minutes, to_char(p.exam_date, 'DD Mon'), to_char(p.starts_at, 'HH24:MI'); end if;
    end if;
  end if;
  if not ok then return null; end if;
  insert into public.question_paper_access (qp_id, school_id, by_user) values (q.id, public.current_school_id(), auth.uid());
  return q.file_key;
end $$;
revoke all on function public.question_paper_key(bigint, bigint) from public, anon;
grant execute on function public.question_paper_key(bigint, bigint) to authenticated;

-- who opened a paper, for the confidential section / central administration
create or replace function public.question_paper_log(p_qp bigint)
returns table (at timestamptz, campus text, who text)
language sql stable security definer set search_path = '' as $$
  select a.at, s.name, coalesce(pr.full_name, 'Unknown') from public.question_paper_access a left join public.school s on s.id = a.school_id
  left join public.profile pr on pr.id = a.by_user join public.question_paper q on q.id = a.qp_id
  where a.qp_id = p_qp and app.can_run_paper(q.school_id) order by a.at desc limit 100;
$$;
revoke all on function public.question_paper_log(bigint) from public, anon;
grant execute on function public.question_paper_log(bigint) to authenticated;

-- ---------- central valuation ----------
-- teaching staff of every campus of the university, to choose evaluators from
create or replace function public.university_evaluators(p_school bigint)
returns table (staff_id bigint, name text, campus text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, sc.name from public.staff s join public.school sc on sc.id = s.school_id
  where app.is_central_for(p_school) and sc.university_id = (select university_id from public.school where id = p_school)
    and s.role in ('subject_teacher', 'class_teacher', 'principal') and (s.left_on is null or s.left_on > (now() at time zone 'Asia/Kolkata')::date)
  order by sc.name, s.full_name;
$$;
revoke all on function public.university_evaluators(bigint) from public, anon;
grant execute on function public.university_evaluators(bigint) to authenticated;

-- each paper of a common exam with its scripts across the campuses
create or replace function public.central_valuation(p_session bigint)
returns table (paper_id bigint, subject text, class_name text, exam_date date, campuses int, scripts int, absent int, unassigned int, marked int, decoded int, evaluators int)
language sql stable security definer set search_path = '' as $$
  select sp.id, sb.name, c.name, sp.exam_date,
    (select count(distinct x.school_id)::int from public.exam_script x join public.exam_paper p on p.id = x.paper_id where p.id = sp.id or p.source_paper_id = sp.id),
    count(x.id)::int, count(x.id) filter (where x.is_absent)::int,
    count(x.id) filter (where not x.is_absent and x.evaluator_id is null and x.status = 'pending')::int,
    count(x.id) filter (where x.status in ('marked', 'decoded') and not x.is_absent)::int,
    count(x.id) filter (where x.status = 'decoded')::int, count(distinct x.evaluator_id)::int
  from public.exam_session es join public.exam_paper sp on sp.session_id = es.id join public.subject sb on sb.id = sp.subject_id left join public.class c on c.id = sp.class_id
  left join public.exam_paper p on p.id = sp.id or p.source_paper_id = sp.id
  left join public.exam_script x on x.paper_id = p.id
  where es.id = p_session and app.is_central_for(es.school_id)
  group by sp.id, sb.name, c.name, sp.exam_date order by sp.exam_date, sb.name;
$$;
revoke all on function public.central_valuation(bigint) from public, anon;
grant execute on function public.central_valuation(bigint) to authenticated;

-- send the coded scripts not yet given out, from every campus, to the chosen evaluators in turn; a script goes to
-- an evaluator from another campus whenever one is chosen
create or replace function public.central_allot(p_paper bigint, p_staff bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare sp public.exam_paper; n int;
begin
  select * into sp from public.exam_paper where id = p_paper and source_paper_id is null;
  if sp.id is null or not app.is_central_for(sp.school_id) then raise exception 'Only central administration can allot scripts across campuses'; end if;
  if coalesce(cardinality(p_staff), 0) = 0 then raise exception 'Choose the evaluators'; end if;
  if exists (select 1 from unnest(p_staff) e where not app.paper_staff_ok(sp.school_id, e)) then raise exception 'Choose staff of the university''s campuses'; end if;
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
revoke all on function public.central_allot(bigint, bigint[]) from public, anon;
grant execute on function public.central_allot(bigint, bigint[]) to authenticated;

-- an evaluator sees the coded scripts given to them, whichever campus they come from (codes only, never names)
create or replace function public.my_scripts()
returns table (id bigint, code text, subject text, exam_date date, max_marks numeric, marks numeric, is_absent boolean, status text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.code, sb.name, p.exam_date, p.max_marks, x.marks, x.is_absent, x.status
  from public.exam_script x join public.exam_paper p on p.id = x.paper_id join public.subject sb on sb.id = p.subject_id
  where app.my_staff_id() is not null and x.evaluator_id = app.my_staff_id() and x.status <> 'decoded'
  order by p.exam_date, sb.name, x.code;
$$;
-- copies remember their source paper
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
  ins as (insert into public.exam_paper (school_id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, component, source_paper_id)
          select p_to, v_new, m.to_class, m.to_subject, m.exam_date, m.starts_at, m.ends_at, m.max_marks, m.component, m.id from m
          where m.to_subject is not null and (m.class_id is null or m.to_class is not null) returning 1)
  select (select count(*) from ins), (select count(*) from m) - (select count(*) from ins) into n, v_skip;
  return jsonb_build_object('session_id', v_new, 'papers', n, 'skipped', v_skip);
end $$;
commit;
notify pgrst, 'reload schema';
