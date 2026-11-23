-- =============================================================================
-- Migration 0047 — Make SECURITY DEFINER functions institution-aware
--
-- SECURITY DEFINER functions bypass RLS, so the restrictive tenant policies from
-- 0046 do NOT protect queries inside them. These functions trust a p_year /
-- p_class / p_student / p_route argument and gate on app.is_admin_scope(), which
-- is true for a principal of ANY institution — so a principal could pass another
-- institution's id and read or write its data. This migration:
--   1. scopes app.current_year_id() to the caller's institution (feeds 17
--      functions + 7 policies), and app.default_school_id();
--   2. guards every caller-reachable report/write function by the caller's
--      institution.
-- Bodies are otherwise unchanged from 0001-0045.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Backbone: the caller's current year is the current year OF THEIR institution.
-- ---------------------------------------------------------------------------
create or replace function app.current_year_id()
 returns bigint language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  select id from public.academic_year
  where is_current and school_id = public.current_school_id()
  limit 1;
$function$;

create or replace function app.default_school_id()
 returns bigint language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  select public.current_school_id();
$function$;

-- ---------------------------------------------------------------------------
-- Report functions — reject an argument from another institution.
-- ---------------------------------------------------------------------------
create or replace function public.class_overview(p_year bigint)
 returns table(class_id bigint, class_name text, class_level smallint, avg_percent numeric, students bigint)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not app.is_admin_scope() then return; end if;
  if (select school_id from public.academic_year where id = p_year) is distinct from public.current_school_id() then return; end if;
  return query
    select cl.id, cl.name, cl.level::smallint,
           round(avg(100.0 * m.marks_obtained / a.max_marks), 1),
           count(distinct m.student_id)
    from public.mark m
    join public.assessment a on a.id = m.assessment_id
    join public.section sec on sec.id = a.section_id
    join public.class cl on cl.id = sec.class_id
    where a.academic_year_id = p_year and a.max_marks > 0 and m.marks_obtained is not null
    group by cl.id, cl.name, cl.level
    order by cl.level;
end $function$;

create or replace function public.school_overview(p_year bigint)
 returns table(students bigint, avg_percent numeric, attendance_pct numeric, slippage bigint)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not app.is_admin_scope() then return; end if;
  if (select school_id from public.academic_year where id = p_year) is distinct from public.current_school_id() then return; end if;
  return query
    select
      (select count(*) from public.student_enrollment where academic_year_id = p_year),
      (select round(avg(100.0 * m.marks_obtained / a.max_marks), 1)
         from public.mark m join public.assessment a on a.id = m.assessment_id
         where a.academic_year_id = p_year and a.max_marks > 0 and m.marks_obtained is not null),
      (select round(100.0 * count(*) filter (where status in ('present','late')) / nullif(count(*), 0), 1)
         from public.attendance_record where academic_year_id = p_year and period is null),
      (select count(*) from public.slippage_flag where is_active and academic_year_id = p_year);
end $function$;

create or replace function public.school_report_summary(p_year bigint, p_start date default null::date, p_end date default null::date, p_exam text default null::text)
 returns table(student_id bigint, section_id bigint, avg_percent numeric, present bigint, total bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with m as (
    select mk.student_id,
           round(avg(mk.marks_obtained / nullif(a.max_marks, 0) * 100), 1) as avg_percent
    from public.mark mk
    join public.assessment a       on a.id  = mk.assessment_id
    join public.assessment_type at on at.id = a.assessment_type_id
    where a.academic_year_id = p_year and at.is_numeric and mk.marks_obtained is not null
      and (case when p_exam is not null then a.name = p_exam
                else a.assessed_on between p_start and p_end end)
    group by mk.student_id
  ),
  att as (
    select r.student_id, r.section_id,
           count(*) filter (where r.status in ('present', 'late')) as present,
           count(*) as total
    from public.attendance_record r
    where p_exam is null and r.period is null and r.on_date between p_start and p_end
    group by r.student_id, r.section_id
  )
  select e.student_id, e.section_id, m.avg_percent,
         coalesce(att.present, 0), coalesce(att.total, 0)
  from public.student_enrollment e
  left join m   on m.student_id = e.student_id
  left join att on att.student_id = e.student_id and att.section_id = e.section_id
  where e.academic_year_id = p_year and app.is_admin_scope()
    and e.school_id = public.current_school_id();
$function$;

create or replace function public.promotable_classes(p_from_year bigint, p_to_year bigint)
 returns table(class_id bigint, class_name text, class_level smallint, students bigint, promoted bigint)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not app.is_admin_scope() then return; end if;
  if (select school_id from public.academic_year where id = p_from_year) is distinct from public.current_school_id() then return; end if;
  return query
    select cl.id, cl.name, cl.level::smallint,
           count(distinct e.student_id),
           (select count(*) from public.promotion p
              join public.section fs on fs.id = p.from_section_id
              where fs.class_id = cl.id and p.to_year_id = p_to_year)
    from public.class cl
    join public.section s on s.class_id = cl.id
    join public.student_enrollment e on e.section_id = s.id and e.academic_year_id = p_from_year
    join public.student st on st.id = e.student_id and st.status = 'active'
    where cl.school_id = public.current_school_id()
    group by cl.id, cl.name, cl.level
    order by cl.level;
end $function$;

create or replace function public.promotion_roster(p_from_year bigint, p_to_year bigint, p_class bigint)
 returns table(student_id bigint, full_name text, roll_no smallint, section_id bigint, section_name text, status text, outcome text, to_section_id bigint)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not app.is_admin_scope() then return; end if;
  if (select school_id from public.class where id = p_class) is distinct from public.current_school_id() then return; end if;
  return query
    select st.id, st.full_name, e.roll_no, s.id, s.name, st.status, p.outcome, p.to_section_id
    from public.student_enrollment e
    join public.section s on s.id = e.section_id
    join public.student st on st.id = e.student_id
    left join public.promotion p on p.student_id = st.id and p.to_year_id = p_to_year
    where s.class_id = p_class and e.academic_year_id = p_from_year
      and s.school_id = public.current_school_id()
    order by s.name, e.roll_no;
end $function$;

create or replace function public.student_standing(p_student bigint, p_year bigint)
 returns table(section_rank integer, section_size integer, class_rank integer, class_size integer, student_avg numeric, section_avg numeric, class_avg numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if (select school_id from public.student where id = p_student) is distinct from public.current_school_id() then return; end if;
  if not app.can_view_student(p_student) then return; end if;

  return query
  with per as (
    select v.student_id, v.section_id, v.class_id, avg(v.percent) as avg
    from public.v_mark_detail v
    where v.academic_year_id = p_year and v.is_numeric and v.marks_obtained is not null
    group by v.student_id, v.section_id, v.class_id
  ),
  me as (select section_id, class_id from per where student_id = p_student limit 1),
  sec as (
    select p.student_id, rank() over (order by p.avg desc) as rnk, count(*) over () as cnt
    from per p where p.section_id = (select section_id from me)
  ),
  cls as (
    select p.student_id, rank() over (order by p.avg desc) as rnk, count(*) over () as cnt
    from per p where p.class_id = (select class_id from me)
  )
  select
    (select rnk from sec where student_id = p_student)::int,
    (select cnt from sec limit 1)::int,
    (select rnk from cls where student_id = p_student)::int,
    (select cnt from cls limit 1)::int,
    (select round(avg, 1) from per where student_id = p_student),
    (select round(avg(avg), 1) from per where section_id = (select section_id from me)),
    (select round(avg(avg), 1) from per where class_id = (select class_id from me));
end $function$;

create or replace function public.crew_stop_rider_counts(p_route bigint)
 returns table(route_stop_id bigint, morning_count integer, afternoon_count integer)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select rs.id,
         count(*) filter (where st.pickup_stop_id = rs.id)::int,
         count(*) filter (where st.drop_stop_id = rs.id)::int
  from public.route_stop rs
    left join public.student_transport st
      on st.route_id = p_route
     and st.is_active
     and st.academic_year_id = app.current_year_id()
     and (st.pickup_stop_id = rs.id or st.drop_stop_id = rs.id)
  where rs.route_id = p_route
    and rs.school_id = public.current_school_id()
    and (
      app.is_admin_scope()
      or exists (
        select 1 from public.bus_assignment a
        where a.id in (select * from app.my_crew_assignments()) and a.route_id = p_route)
    )
  group by rs.id;
$function$;

-- ---------------------------------------------------------------------------
-- Write functions — refuse to act on another institution's rows.
-- ---------------------------------------------------------------------------
create or replace function public.create_class_exam(p_class bigint, p_subject bigint, p_name text, p_term integer, p_max numeric, p_date date, p_year bigint, p_type text default 'periodic_test'::text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_type bigint; v_cnt int := 0; v_sec bigint;
begin
  if (select school_id from public.class where id = p_class) is distinct from public.current_school_id()
     or (select school_id from public.subject where id = p_subject) is distinct from public.current_school_id() then
    raise exception 'not authorized to create exams for this class';
  end if;
  if not (
    app.is_admin_scope()
    or exists (select 1 from public.teacher_allotment ta
               join public.section s on s.id = ta.section_id
               where s.class_id = p_class and ta.academic_year_id = p_year
                 and ta.staff_id = app.my_staff_id()
                 and (ta.subject_id = p_subject or ta.is_class_teacher))
  ) then raise exception 'not authorized to create exams for this class'; end if;

  if coalesce(btrim(p_name), '') = '' then raise exception 'exam name required'; end if;

  select id into v_type from public.assessment_type where code = p_type and school_id = public.current_school_id();
  if v_type is null then select id into v_type from public.assessment_type where code = 'periodic_test' and school_id = public.current_school_id(); end if;

  for v_sec in select id from public.section where class_id = p_class loop
    if not exists (select 1 from public.assessment a
                   where a.section_id = v_sec and a.subject_id = p_subject
                     and a.academic_year_id = p_year and a.name = p_name) then
      insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, is_published)
        values (v_type, p_subject, v_sec, p_year, p_term, btrim(p_name), p_date, p_max, false);
      v_cnt := v_cnt + 1;
    end if;
  end loop;
  return v_cnt;
end $function$;

create or replace function public.commit_promotion(p_from_year bigint, p_to_year bigint, p_rows jsonb)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; cnt int := 0;
        v_student bigint; v_outcome text; v_to_section bigint; v_from_section bigint; v_roll smallint;
        v_to_start date;
begin
  if not app.is_admin_scope() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.academic_year where id in (p_from_year, p_to_year)
             and school_id is distinct from public.current_school_id()) then
    raise exception 'not authorized';
  end if;
  select start_date into v_to_start from public.academic_year where id = p_to_year;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_student   := (r->>'student_id')::bigint;
    v_outcome   := r->>'outcome';
    v_to_section := nullif(r->>'to_section_id','')::bigint;
    if (select school_id from public.student where id = v_student) is distinct from public.current_school_id() then
      raise exception 'not authorized';
    end if;
    select section_id, roll_no into v_from_section, v_roll
      from public.student_enrollment where student_id = v_student and academic_year_id = p_from_year;

    if v_outcome in ('promoted','retained') then
      if v_to_section is null then raise exception 'target section required for student %', v_student; end if;
      insert into public.student_enrollment (student_id, academic_year_id, section_id, roll_no)
        values (v_student, p_to_year, v_to_section, coalesce(v_roll, 0))
        on conflict (student_id, academic_year_id) do update set section_id = excluded.section_id;
    elsif v_outcome = 'transferred' then
      update public.student set status = 'transferred', left_on = coalesce(v_to_start, left_on),
             exit_remark = coalesce(nullif(btrim(r->>'remark'), ''), exit_remark) where id = v_student;
    elsif v_outcome = 'graduated' then
      update public.student set status = 'alumni', left_on = coalesce(v_to_start, left_on) where id = v_student;
    else
      raise exception 'unknown outcome %', v_outcome;
    end if;

    insert into public.promotion (student_id, from_year_id, to_year_id, from_section_id, to_section_id, outcome, decided_by)
      values (v_student, p_from_year, p_to_year, v_from_section,
              case when v_outcome in ('promoted','retained') then v_to_section else null end, v_outcome, app.my_staff_id())
      on conflict (student_id, to_year_id) do update
        set outcome = excluded.outcome, to_section_id = excluded.to_section_id,
            from_section_id = excluded.from_section_id, decided_by = excluded.decided_by, created_at = now();
    cnt := cnt + 1;
  end loop;
  update public.student_enrollment e set roll_no = r.rn
  from (
    select id, row_number() over (partition by section_id order by (select full_name from public.student where id = student_id)) rn
    from public.student_enrollment where academic_year_id = p_to_year
  ) r where e.id = r.id and e.academic_year_id = p_to_year;
  return cnt;
end $function$;

create or replace function public.homework_submit(p_homework bigint, p_student bigint, p_note text, p_link text)
 returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hw   public.homework%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_checked timestamptz;
  v_id   bigint;
begin
  if p_student is null or not app.owns_student(p_student) then
    raise exception 'You can only submit homework for yourself or your own child.';
  end if;

  select * into v_hw from public.homework where id = p_homework;
  if not found or v_hw.school_id is distinct from public.current_school_id() then
    raise exception 'This homework no longer exists.';
  end if;

  if not exists (
    select 1 from public.student_enrollment e
    where e.student_id = p_student
      and e.section_id = v_hw.section_id
      and e.academic_year_id = v_hw.academic_year_id
  ) then
    raise exception 'This homework was not set for this student.';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note is too long. Keep it under 1000 characters.';
  end if;
  if v_link is not null and (v_link not like 'https://%' or char_length(v_link) > 500 or v_link ~ '\s') then
    raise exception 'The link must start with https:// and be under 500 characters.';
  end if;

  select s.checked_at into v_checked from public.homework_submission s
  where s.homework_id = p_homework and s.student_id = p_student
  for update;
  if found and v_checked is not null then
    raise exception 'This homework has already been checked and cannot be changed.';
  end if;

  insert into public.homework_submission (homework_id, student_id, note, link_url, submitted_at, is_late)
    values (p_homework, p_student, v_note, v_link, now(), app.school_today() > v_hw.due_date)
  on conflict (homework_id, student_id) do update
    set note = excluded.note,
        link_url = excluded.link_url,
        submitted_at = excluded.submitted_at,
        is_late = excluded.is_late
    where homework_submission.checked_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'This homework has already been checked and cannot be changed.';
  end if;
  return v_id;
end $function$;

create or replace function public.fee_payment_before_insert()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  select i.student_id into new.student_id from public.fee_invoice i
   where i.id = new.invoice_id and i.school_id = new.school_id;
  if new.student_id is null then
    raise exception 'Fee invoice % not found', new.invoice_id;
  end if;
  new.receipt_no := 'R-' || to_char(coalesce(new.paid_on, current_date), 'YYYY') || '-'
                    || lpad(nextval('public.fee_receipt_seq')::text, 6, '0');
  return new;
end $function$;

create or replace function public.on_attendance_change()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.period is null then
    if new.status = 'absent' then
      insert into public.absence_notice (student_id, section_id, academic_year_id, on_date, school_id)
      values (new.student_id, new.section_id, new.academic_year_id, new.on_date, new.school_id)
      on conflict (student_id, on_date) do nothing;
    else
      delete from public.absence_notice
      where student_id = new.student_id and on_date = new.on_date and status = 'pending';
    end if;
  end if;
  return new;
end $function$;
