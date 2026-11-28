-- The remaining review items: exams (unique booklets, rooms for scribes, duty roles and rates per exam, paid remuneration,
-- leave warnings), staff who have left, leave chain per type with notices and escalation, transfer equivalence, fee and the
-- receiving campus's consent, timetable consecutive limit and drafts with notices, common exam re-sync.
begin;
create unique index if not exists uq_exam_seat_booklet on public.exam_seat (session_id, upper(booklet_no)) where booklet_no is not null;
alter table public.exam_room add column if not exists special boolean not null default false;
alter table public.exam_duty add column if not exists role text not null default 'invigilator' check (role in ('invigilator', 'chief', 'squad', 'relieving'));
alter table public.exam_rate drop constraint if exists exam_rate_kind_check;
alter table public.exam_rate add constraint exam_rate_kind_check check (kind in ('duty', 'script', 'chief', 'squad', 'relieving'));
alter table public.exam_rate add column if not exists session_id bigint references public.exam_session(id) on delete cascade;
alter table public.exam_rate drop constraint if exists exam_rate_pkey;
create unique index if not exists uq_exam_rate on public.exam_rate (school_id, kind, coalesce(session_id, 0));
create table if not exists public.exam_remuneration_paid (
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  session_id bigint not null references public.exam_session(id) on delete cascade,
  staff_id   bigint not null references public.staff(id) on delete cascade,
  amount     numeric(12,2) not null,
  paid_on    date not null,
  reference  text check (reference is null or char_length(reference) <= 80),
  primary key (session_id, staff_id)
);
alter table public.exam_remuneration_paid enable row level security;
drop policy if exists tenant_isolation on public.exam_remuneration_paid;
create policy tenant_isolation on public.exam_remuneration_paid as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists erp_read on public.exam_remuneration_paid;
create policy erp_read on public.exam_remuneration_paid for select to authenticated using ((select app.is_exams()) or (select app.is_finance()) or staff_id = (select app.my_staff_id()));
revoke all on public.exam_remuneration_paid from anon, authenticated;
grant select on public.exam_remuneration_paid to authenticated;
grant all on public.exam_remuneration_paid to service_role;

-- what each person is owed: invigilation by role, scripts valued; the exam's own rates first, else the institution's
drop function if exists public.exam_remuneration(bigint);
create function public.exam_remuneration(p_session bigint)
returns table (staff_id bigint, staff_name text, employee_code text, duties int, scripts int, duty_amount numeric, script_amount numeric, total numeric, paid_on date, paid_ref text)
language sql stable security definer set search_path = '' as $$
  with rate as (select k.kind, coalesce((select amount from public.exam_rate r where r.school_id = (select public.current_school_id()) and r.kind = k.kind and r.session_id = p_session),
                                        (select amount from public.exam_rate r where r.school_id = (select public.current_school_id()) and r.kind = k.kind and r.session_id is null), 0) amount
                from (values ('duty'), ('chief'), ('squad'), ('relieving'), ('script')) k(kind)),
  du as (select d.staff_id, count(*)::int n, sum((select amount from rate where kind = case d.role when 'invigilator' then 'duty' else d.role end)) amt
         from public.exam_duty d where d.session_id = p_session and d.exam_date <= (now() at time zone 'Asia/Kolkata')::date group by 1),
  sc as (select x.evaluator_id staff_id, count(*)::int n from public.exam_script x join public.exam_paper p on p.id = x.paper_id
         where p.session_id = p_session and x.evaluator_id is not null and not x.is_absent and x.status in ('marked', 'decoded') group by 1),
  who as (select staff_id from du union select staff_id from sc)
  select st.id, st.full_name, st.employee_code, coalesce(du.n, 0), coalesce(sc.n, 0), coalesce(du.amt, 0), coalesce(sc.n, 0) * (select amount from rate where kind = 'script'),
         coalesce(du.amt, 0) + coalesce(sc.n, 0) * (select amount from rate where kind = 'script'), pd.paid_on, pd.reference
  from who join public.staff st on st.id = who.staff_id left join du on du.staff_id = who.staff_id left join sc on sc.staff_id = who.staff_id
  left join public.exam_remuneration_paid pd on pd.session_id = p_session and pd.staff_id = st.id
  where st.school_id = (select public.current_school_id()) and ((select app.is_exams()) or (select app.is_finance()))
    and exists (select 1 from public.exam_session es where es.id = p_session and es.school_id = st.school_id)
  order by st.full_name;
$$;
revoke all on function public.exam_remuneration(bigint) from public, anon;
grant execute on function public.exam_remuneration(bigint) to authenticated;

create or replace function public.mark_remuneration_paid(p_session bigint, p_staff bigint[], p_paid_on date, p_ref text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (app.is_finance() or app.is_exams_lead()) then raise exception 'Only accounts or the Controller of Examinations can mark payments'; end if;
  insert into public.exam_remuneration_paid (school_id, session_id, staff_id, amount, paid_on, reference)
  select public.current_school_id(), p_session, r.staff_id, r.total, coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date), left(nullif(trim(p_ref), ''), 80)
  from public.exam_remuneration(p_session) r where r.staff_id = any(p_staff) and r.total > 0
  on conflict (session_id, staff_id) do update set amount = excluded.amount, paid_on = excluded.paid_on, reference = excluded.reference;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_remuneration_paid(bigint, bigint[], date, text) from public, anon;
grant execute on function public.mark_remuneration_paid(bigint, bigint[], date, text) to authenticated;

create or replace function public.set_duty_role(p_duty bigint, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_exams() then raise exception 'Only the exam cell can change duties'; end if;
  if p_role not in ('invigilator', 'chief', 'squad', 'relieving') then raise exception 'Unknown role'; end if;
  update public.exam_duty set role = p_role where id = p_duty and school_id = public.current_school_id();
end $$;
revoke all on function public.set_duty_role(bigint, text) from public, anon;
grant execute on function public.set_duty_role(bigint, text) to authenticated;

-- duties held by someone whose leave was approved after the duties were given
create or replace function public.duties_on_leave(p_session bigint)
returns table (duty_id bigint, staff_name text, exam_date date)
language sql stable security definer set search_path = '' as $$
  select d.id, s.full_name, d.exam_date from public.exam_duty d join public.staff s on s.id = d.staff_id
  where d.session_id = p_session and d.school_id = (select public.current_school_id()) and (select app.is_exams())
    and exists (select 1 from public.staff_leave l where l.staff_id = d.staff_id and l.status = 'approved' and d.exam_date between l.from_date and l.to_date);
$$;
revoke all on function public.duties_on_leave(bigint) from public, anon;
grant execute on function public.duties_on_leave(bigint) to authenticated;

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
    -- students with a scribe or extra time first, so they fill the rooms set aside for them
    ordered as (select c2.student_id, row_number() over (order by (exists (select 1 from public.exam_accommodation a where a.student_id = c2.student_id and (a.session_id = p_session or a.session_id is null))) desc, c2.rn, c2.grp, c2.student_id) k from c2),
    rooms as (select r.id, coalesce(sum(r.capacity) over (order by r.special desc, r.sort, r.name rows between unbounded preceding and 1 preceding), 0) lo, sum(r.capacity) over (order by r.special desc, r.sort, r.name) hi
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
  update public.exam_seat x set seat_label = case when r.rows_n is null or r.benches_n is null then x.seat_no::text else
      'R' || (((x.seat_no - 1) / r.per_bench) / r.benches_n + 1) || '-B' || (((x.seat_no - 1) / r.per_bench) % r.benches_n + 1)
      || case when r.per_bench > 1 then chr(65 + ((x.seat_no - 1) % r.per_bench)) else '' end end
  from public.exam_room r where r.id = x.room_id and x.session_id = p_session;
  select count(*) into n from public.exam_seat where session_id = p_session;
  return n;
end $$;

alter table public.staff add column if not exists left_on date;

create or replace function public.statistics_for(p_school bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with yr as (select y.id from public.academic_year y where y.school_id = p_school and y.is_current),
  en as (select e.student_id, st.gender::text gender, g.id prog_id, g.name programme, g.years, g.intake, c.year_no, i.category::text category, i.special_needs, i.minority, p.state
         from public.student_enrollment e join yr on e.academic_year_id = yr.id join public.student st on st.id = e.student_id
         join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id left join public.programme g on g.id = c.programme_id
         left join public.student_identity i on i.student_id = st.id left join public.student_profile p on p.student_id = st.id
         where e.status = 'active' and e.school_id = p_school),
  stf as (select s.* from public.staff s where s.school_id = p_school and s.role in ('subject_teacher', 'class_teacher', 'principal') and (s.left_on is null or s.left_on > (now() at time zone 'Asia/Kolkata')::date)),
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

alter table public.staff_leave_type add column if not exists chain text not null default 'hod_dean' check (chain in ('hod_dean', 'hod', 'office'));
alter table public.staff_leave add column if not exists step_since timestamptz;
create or replace function public.staff_leave_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_steps text[] := '{}'; v_chain text;
begin
  new.step_log := '[]'::jsonb; new.steps := null; new.step := null; new.step_since := now();
  if not public.is_higher_ed(new.school_id) then return new; end if;
  select coalesce(chain, 'hod_dean') into v_chain from public.staff_leave_type where id = new.leave_type_id;
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

-- the person at the current step is told (a Head or Dean), after the request is saved and at each step
create or replace function public.staff_leave_tell_step() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status <> 'pending' or new.step not in ('hod', 'dean') or (tg_op = 'UPDATE' and new.step is not distinct from old.step) then return new; end if;
  for r in select distinct p.staff_id from public.staff_position p join public.position_title t on t.id = p.title_id
           where p.school_id = new.school_id and t.access_type = case new.step when 'hod' then 'dept_head' else 'dean' end and p.staff_id <> new.staff_id
             and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
             and ((new.step = 'hod' and p.department_id in (select app.staff_home_departments(new.staff_id)))
               or (new.step = 'dean' and p.unit_id is not null and exists (select 1 from public.department d where d.id in (select app.staff_home_departments(new.staff_id)) and d.unit_id in (select public.unit_descendants(p.unit_id))))) loop
    perform public.notify_safe(new.school_id, 'leave_request', 'leave-step:' || new.id || ':' || new.step, null, r.staff_id, null,
      jsonb_build_object('who', (select full_name from public.staff where id = new.staff_id)), 'Leave waiting for you', '{who} has asked for leave. It is waiting for your recommendation.', '/dashboard');
  end loop;
  return new;
exception when others then return new;
end $$;
drop trigger if exists trg_staff_leave_tell on public.staff_leave;
create trigger trg_staff_leave_tell after insert or update of step on public.staff_leave for each row execute function public.staff_leave_tell_step();

-- a step not taken in three days moves on by itself (recorded)
create or replace function public.escalate_staff_leave() returns int
language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0; v_next text;
begin
  perform set_config('app.leave_step', 'on', true);
  for l in select * from public.staff_leave where status = 'pending' and step in ('hod', 'dean') and coalesce(step_since, created_at) < now() - interval '3 days' loop
    v_next := l.steps[array_position(l.steps, l.step) + 1];
    update public.staff_leave set step = coalesce(v_next, 'final'), step_since = now(),
      step_log = step_log || jsonb_build_object('step', l.step, 'at', now(), 'ok', true, 'note', 'Moved on after three days without a decision', 'override', true) where id = l.id;
    n := n + 1;
  end loop;
  perform set_config('app.leave_step', 'off', true);
  return n;
end $$;
revoke all on function public.escalate_staff_leave() from public, anon, authenticated;
select cron.unschedule('leave-escalation') where exists (select 1 from cron.job where jobname = 'leave-escalation');
select cron.schedule('leave-escalation', '0 2 * * *', 'select public.escalate_staff_leave()');

create or replace function public.advance_staff_leave(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.staff_leave; v_ok boolean; v_override boolean := false; v_next text;
begin
  select * into l from public.staff_leave where id = p_id and school_id = public.current_school_id() for update;
  if l.id is null or l.status <> 'pending' or l.step is null or l.step = 'final' then raise exception 'Nothing waiting for you here'; end if;
  if l.staff_id = app.my_staff_id() then raise exception 'You cannot decide your own leave'; end if;
  v_ok := case l.step
    when 'hod' then exists (select 1 from app.staff_home_departments(l.staff_id) d where d in (select app.my_headed_departments()))
    when 'dean' then exists (select 1 from app.staff_home_departments(l.staff_id) d where d in (select app.my_dean_departments())) end;
  if not coalesce(v_ok, false) then
    if coalesce(app.is_head(), false) or coalesce(app.is_office(), false) then v_override := true;
    else raise exception 'This step is for the % of the teacher''s department', case l.step when 'hod' then 'Head' else 'Dean' end; end if;
  end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Give the reason for refusing'; end if;
  perform set_config('app.leave_step', 'on', true);
  if not p_approve then
    update public.staff_leave set status = 'rejected', decided_by = app.my_staff_id(), decided_at = now(), decision_note = left(trim(p_note), 500),
      step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'name', (select full_name from public.staff where id = app.my_staff_id()), 'at', now(), 'ok', false, 'note', left(p_note, 200), 'override', v_override) where id = l.id;
    perform set_config('app.leave_step', 'off', true);
    return 'rejected';
  end if;
  v_next := l.steps[array_position(l.steps, l.step) + 1];
  update public.staff_leave set step = coalesce(v_next, 'final'), step_since = now(),
    step_log = step_log || jsonb_build_object('step', l.step, 'by', app.my_staff_id(), 'name', (select full_name from public.staff where id = app.my_staff_id()), 'at', now(), 'ok', true, 'note', left(coalesce(p_note, ''), 200), 'override', v_override) where id = l.id;
  perform set_config('app.leave_step', 'off', true);
  return coalesce(v_next, 'final');
end $$;

create table if not exists public.course_equivalence (
  university_id bigint not null references public.university(id) on delete cascade,
  from_course_id bigint not null references public.course(id) on delete cascade,
  to_school     bigint not null references public.school(id) on delete cascade,
  to_course_id  bigint not null references public.course(id) on delete cascade,
  primary key (from_course_id, to_school)
);
alter table public.course_equivalence enable row level security;
drop policy if exists ce_read on public.course_equivalence;
create policy ce_read on public.course_equivalence for select to authenticated using (university_id = (select public.current_university_id()));
revoke all on public.course_equivalence from anon, authenticated;
grant select on public.course_equivalence to authenticated;
grant all on public.course_equivalence to service_role;
alter table public.school add column if not exists transfer_fee numeric(10,2) check (transfer_fee is null or transfer_fee >= 0);
alter table public.transfer_request add column if not exists receiving_ok boolean, add column if not exists receiving_note text, add column if not exists invoice_id bigint references public.fee_invoice(id) on delete set null;

create or replace function public.transfer_mapping(p_from_student bigint, p_to bigint)
returns table (from_course_id bigint, code text, name text, credits numeric, grade text, suggested bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (c.id) c.id, c.code, c.name, cr.credits, cr.grade,
    coalesce((select e.to_course_id from public.course_equivalence e where e.from_course_id = c.id and e.to_school = p_to),
             (select tc.id from public.course tc where tc.school_id = p_to and tc.code = c.code limit 1))
  from public.course_result cr join public.course c on c.id = cr.course_id join public.student s on s.id = cr.student_id
  where cr.student_id = p_from_student and app.is_central_for(s.school_id) and app.is_central_for(p_to) and cr.counts
  order by c.id, cr.attempt desc;
$$;

-- the receiving campus's office agrees (seats, intake) or declines
create or replace function public.receive_transfer(p_id bigint, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can answer'; end if;
  update public.transfer_request set receiving_ok = p_ok, receiving_note = left(nullif(trim(p_note), ''), 200)
   where id = p_id and to_school = public.current_school_id() and status = 'requested';
  if not found then raise exception 'No waiting request for this campus'; end if;
end $$;
revoke all on function public.receive_transfer(bigint, boolean, text) from public, anon;
grant execute on function public.receive_transfer(bigint, boolean, text) to authenticated;

create or replace function public.incoming_transfers()
returns table (id bigint, student_name text, from_campus text, programme text, reason text, receiving_ok boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, s.full_name, sc.name,
    (select g.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id where e.student_id = s.id and e.status = 'active' limit 1),
    r.reason, r.receiving_ok, r.created_at
  from public.transfer_request r join public.student s on s.id = r.student_id join public.school sc on sc.id = r.from_school
  where r.to_school = public.current_school_id() and r.status = 'requested' and coalesce(app.is_admin_scope(), false)
  order by r.created_at;
$$;
revoke all on function public.incoming_transfers() from public, anon;
grant execute on function public.incoming_transfers() to authenticated;

create or replace function public.request_campus_transfer(p_student bigint, p_to bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_uni bigint; v_id bigint;
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
            (select transfer_fee from public.school where id = v_school), (now() at time zone 'Asia/Kolkata')::date + 7, 'due');
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
  on conflict (from_course_id, to_school) do update set to_course_id = excluded.to_course_id;
  return j || jsonb_build_object('order_no', v_no);
end $$;

alter table public.school add column if not exists tt_max_consecutive smallint not null default 4 check (tt_max_consecutive between 1 and 12);
create table if not exists public.timetable_draft (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  section_ids bigint[] not null,
  rows        jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.timetable_draft enable row level security;
drop policy if exists tenant_isolation on public.timetable_draft;
create policy tenant_isolation on public.timetable_draft as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists td_rw on public.timetable_draft;
create policy td_rw on public.timetable_draft for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
revoke all on public.timetable_draft from anon;
grant select, insert, delete on public.timetable_draft to authenticated;
grant all on public.timetable_draft to service_role;

create or replace function public.set_timetable_consecutive(p_max int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change this'; end if;
  update public.school set tt_max_consecutive = greatest(least(coalesce(p_max, 4), 12), 1) where id = public.current_school_id();
end $$;
revoke all on function public.set_timetable_consecutive(int) from public, anon;
grant execute on function public.set_timetable_consecutive(int) to authenticated;

-- teachers and families of the sections are told when a new timetable is saved
create or replace function public.tell_timetable_saved(p_sections bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_office(), false) then return 0; end if;
  for r in select distinct t.staff_id from public.timetable_slot t join public.academic_year y on y.id = t.academic_year_id and y.is_current where t.section_id = any(p_sections) and t.staff_id is not null loop
    if public.notify_safe(v_school, 'announcement', 'tt:' || r.staff_id || ':' || to_char(now(), 'YYYYMMDDHH24'), null, r.staff_id, null, '{}'::jsonb, 'New timetable', 'Your timetable has changed. See Schedule.', '/dashboard/schedule') is not null then n := n + 1; end if;
  end loop;
  for r in select distinct e.student_id from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.section_id = any(p_sections) and e.status = 'active' limit 3000 loop
    perform public.notify_family(v_school, 'announcement', 'tt:' || to_char(now(), 'YYYYMMDDHH24'), r.student_id, '{}'::jsonb, 'New timetable', 'The class timetable has changed. See Schedule.', '/dashboard/schedule');
  end loop;
  return n;
end $$;
revoke all on function public.tell_timetable_saved(bigint[]) from public, anon;
grant execute on function public.tell_timetable_saved(bigint[]) to authenticated;

create or replace function public.resync_exam_copies(p_session bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare es public.exam_session; n int;
begin
  select * into es from public.exam_session where id = p_session;
  if es.id is null or not app.is_central_for(es.school_id) then raise exception 'Only central administration can do this'; end if;
  -- each copied paper takes the source paper's date and times (matched by subject name)
  update public.exam_paper cp set exam_date = sp.exam_date, starts_at = sp.starts_at, ends_at = sp.ends_at, max_marks = sp.max_marks
  from public.exam_session cs, public.exam_paper sp, public.subject ss, public.subject cps
  where cs.source_session_id = p_session and cp.session_id = cs.id and sp.session_id = p_session and ss.id = sp.subject_id and cps.id = cp.subject_id
    and lower(ss.name) = lower(cps.name) and (cp.exam_date, cp.starts_at, cp.ends_at, cp.max_marks) is distinct from (sp.exam_date, sp.starts_at, sp.ends_at, sp.max_marks);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.resync_exam_copies(bigint) from public, anon;
grant execute on function public.resync_exam_copies(bigint) to authenticated;
-- rates for duties and scripts: for the institution, or one exam's own
create or replace function public.set_exam_rates(p_session bigint, p_rates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not app.is_exams_lead() then raise exception 'Only the Controller of Examinations (or a deputy) can set rates'; end if;
  if p_session is not null and not exists (select 1 from public.exam_session where id = p_session and school_id = v_school) then raise exception 'Unknown exam'; end if;
  delete from public.exam_rate where school_id = v_school and session_id is not distinct from p_session;
  insert into public.exam_rate (school_id, kind, amount, session_id)
  select v_school, k, (p_rates ->> k)::numeric, p_session from jsonb_object_keys(p_rates) k
  where k in ('duty', 'script', 'chief', 'squad', 'relieving') and nullif(p_rates ->> k, '') is not null and (p_rates ->> k)::numeric >= 0;
end $$;
revoke all on function public.set_exam_rates(bigint, jsonb) from public, anon;
grant execute on function public.set_exam_rates(bigint, jsonb) to authenticated;

create or replace function public.set_transfer_fee(p_fee numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can set the transfer fee'; end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 999999) then raise exception 'Enter the fee in rupees'; end if;
  update public.school set transfer_fee = p_fee where id = public.current_school_id();
end $$;
revoke all on function public.set_transfer_fee(numeric) from public, anon;
grant execute on function public.set_transfer_fee(numeric) to authenticated;
commit;
notify pgrst, 'reload schema';
