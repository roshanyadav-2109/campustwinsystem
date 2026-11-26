-- Course registration, after the product + CTO review of 0119-0122.
begin;
alter table public.semester add column if not exists registration_closes date;
alter table public.semester add column if not exists add_drop_until date;

-- this institution's students only; owner or office; summer has no semester number
create or replace function public.student_semester(p_student bigint, p_semester bigint)
returns table (programme_id bigint, semester_no int)
language sql stable security definer set search_path = '' as $$
  select c.programme_id, (2 * c.year_no - case when s.kind = 'odd' then 1 else 0 end)::int
  from public.semester s
  join public.student_enrollment e on e.student_id = p_student and e.academic_year_id = s.academic_year_id and e.status = 'active'
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  where s.id = p_semester and s.school_id = public.current_school_id() and s.kind in ('odd', 'even')
    and c.programme_id is not null and c.year_no is not null
    and (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null);
$$;
revoke all on function public.student_semester(bigint, bigint) from public, anon;
grant execute on function public.student_semester(bigint, bigint) to authenticated;

create or replace function public.register_course(p_semester bigint, p_student bigint, p_pc bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); pc public.programme_course; st record; v_used int; v_credits numeric; v_max numeric; v_new numeric; s public.semester; v_office boolean := coalesce(app.is_office(), false);
begin
  if not (v_office or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  select * into s from public.semester where id = p_semester and school_id = v_school;
  if s.id is null or not s.is_current then raise exception 'Registration is only for the current semester'; end if;
  if not v_office and s.registration_closes is not null and (now() at time zone 'Asia/Kolkata')::date > s.registration_closes then raise exception 'Registration closed on %', to_char(s.registration_closes, 'DD/MM/YYYY'); end if;
  -- one request per student at a time
  perform pg_advisory_xact_lock(hashtextextended('course_student:' || p_semester || ':' || p_student, 0));
  select * into st from public.student_semester(p_student, p_semester);
  select * into pc from public.programme_course where id = p_pc and school_id = v_school;
  if pc.id is null or st.programme_id is distinct from pc.programme_id or st.semester_no <> pc.semester_no then raise exception 'This course is not in the student''s semester'; end if;
  perform pg_advisory_xact_lock(hashtextextended('course_seat:' || p_semester || ':' || p_pc, 0));
  if pc.seat_limit is not null then
    select count(*) into v_used from public.course_registration where semester_id = p_semester and programme_course_id = p_pc and status <> 'dropped' and student_id <> p_student;
    if v_used >= pc.seat_limit then raise exception 'This course is full (% seats)', pc.seat_limit; end if;
  end if;
  if pc.elective_group is not null then
    if not v_office and exists (select 1 from public.course_registration r join public.programme_course x on x.id = r.programme_course_id
         where x.elective_group = pc.elective_group and x.programme_id = pc.programme_id and r.semester_id = p_semester and r.student_id = p_student
           and r.programme_course_id <> p_pc and r.status = 'approved') then
      raise exception 'Your choice in this group is already approved. Ask the office to change it.';
    end if;
    update public.course_registration r set status = 'dropped'
      from public.programme_course x where x.id = r.programme_course_id and x.elective_group = pc.elective_group and x.programme_id = pc.programme_id
       and r.semester_id = p_semester and r.student_id = p_student and r.programme_course_id <> p_pc and r.status <> 'dropped';
  end if;
  select max_credits_per_semester into v_max from public.programme where id = pc.programme_id;
  if v_max is not null then
    select coalesce(sum(c.credits), 0) into v_credits from public.course_registration r join public.programme_course x on x.id = r.programme_course_id join public.course c on c.id = x.course_id
     where r.semester_id = p_semester and r.student_id = p_student and r.status <> 'dropped' and r.programme_course_id <> p_pc;
    select credits into v_new from public.course where id = pc.course_id;
    if v_credits + v_new > v_max then raise exception 'This takes the semester over % credits', v_max; end if;
  end if;
  insert into public.course_registration (school_id, semester_id, student_id, programme_course_id)
  values (v_school, p_semester, p_student, p_pc)
  on conflict (semester_id, student_id, programme_course_id) do update set status = 'registered' where public.course_registration.status = 'dropped';
  return 'registered';
end $$;

create or replace function public.drop_course(p_semester bigint, p_student bigint, p_pc bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.semester; v_office boolean := coalesce(app.is_office(), false);
begin
  if not (v_office or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  select * into s from public.semester where id = p_semester and school_id = public.current_school_id();
  if not v_office then
    if exists (select 1 from public.programme_course where id = p_pc and elective_group is null) then raise exception 'Core courses cannot be dropped'; end if;
    if exists (select 1 from public.course_registration where semester_id = p_semester and student_id = p_student and programme_course_id = p_pc and status = 'approved') then
      raise exception 'This choice is approved. Ask the office to change it.';
    end if;
    if s.add_drop_until is not null and (now() at time zone 'Asia/Kolkata')::date > s.add_drop_until then raise exception 'Add and drop closed on %', to_char(s.add_drop_until, 'DD/MM/YYYY'); end if;
  end if;
  update public.course_registration set status = 'dropped' where semester_id = p_semester and student_id = p_student and programme_course_id = p_pc and school_id = public.current_school_id();
end $$;

-- one step: there is always exactly one current semester
create or replace function public.set_current_semester(p_semester bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change the semester'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  update public.semester set is_current = false where school_id = v_school and is_current and id <> p_semester;
  update public.semester set is_current = true where id = p_semester;
end $$;
revoke all on function public.set_current_semester(bigint) from public, anon;
grant execute on function public.set_current_semester(bigint) to authenticated;

-- registrations: office/principal, the student, and teachers of that course
drop policy if exists cr_read on public.course_registration;
create policy cr_read on public.course_registration for select to authenticated
  using ((select app.is_admin_scope()) or app.owns_student(student_id)
         or exists (select 1 from public.programme_course pc join public.subject sb on sb.course_id = pc.course_id
                    join public.teacher_allotment ta on ta.subject_id = sb.id and ta.staff_id = (select app.my_staff_id())
                    where pc.id = programme_course_id));

-- credits per semester: core plus the largest course of each choice group
create or replace function public.programme_credits(p_programme bigint)
returns table (semester_no smallint, courses int, credits numeric)
language sql stable security definer set search_path = '' as $$
  with x as (
    select pc.semester_no, pc.elective_group, c.credits from public.programme_course pc join public.course c on c.id = pc.course_id
    where pc.programme_id = p_programme and pc.school_id = public.current_school_id())
  select x.semester_no, count(*)::int,
    coalesce(sum(x.credits) filter (where x.elective_group is null), 0)
    + coalesce((select sum(m) from (select max(y.credits) m from x y where y.semester_no = x.semester_no and y.elective_group is not null group by y.elective_group) g), 0)
  from x group by x.semester_no order by 1;
$$;
commit;
