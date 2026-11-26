-- Higher education, step 3: course registration and electives.
-- Each student registers for the courses of their semester (semester number =
-- 2 x year - 1 in the odd semester, 2 x year in the even one). Core courses
-- are registered automatically; electives are chosen, one per choice group,
-- within the elective's seat limit (the last seat goes to exactly one
-- student) and the programme's credit limit. The office approves.
begin;
alter table public.programme_course add column if not exists seat_limit int check (seat_limit is null or seat_limit between 1 and 5000);
alter table public.programme add column if not exists max_credits_per_semester numeric(4,1);

create table if not exists public.course_registration (
  id                  bigint generated always as identity primary key,
  school_id           bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  semester_id         bigint not null references public.semester(id) on delete cascade,
  student_id          bigint not null references public.student(id) on delete cascade,
  programme_course_id bigint not null references public.programme_course(id) on delete cascade,
  status              text not null default 'registered' check (status in ('registered', 'approved', 'dropped')),
  created_at          timestamptz not null default now(),
  unique (semester_id, student_id, programme_course_id)
);
create index if not exists idx_course_reg_pc on public.course_registration (programme_course_id, semester_id) where status <> 'dropped';
alter table public.course_registration enable row level security;
drop policy if exists tenant_isolation on public.course_registration;
create policy tenant_isolation on public.course_registration as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists cr_read on public.course_registration;
create policy cr_read on public.course_registration for select to authenticated
  using ((select app.is_admin_scope()) or app.owns_student(student_id) or app.my_staff_id() is not null);
revoke all on public.course_registration from anon, authenticated;
grant select on public.course_registration to authenticated;
grant all on public.course_registration to service_role;

-- the student's semester number and programme now
create or replace function public.student_semester(p_student bigint, p_semester bigint)
returns table (programme_id bigint, semester_no int)
language sql stable security definer set search_path = '' as $$
  select c.programme_id, (2 * c.year_no - case when s.kind = 'odd' then 1 else 0 end)::int
  from public.semester s
  join public.student_enrollment e on e.student_id = p_student and e.academic_year_id = s.academic_year_id and e.status = 'active'
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  where s.id = p_semester and c.programme_id is not null and c.year_no is not null;
$$;

-- a student (their own) or the office registers one course
create or replace function public.register_course(p_semester bigint, p_student bigint, p_pc bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); pc public.programme_course; st record; v_used int; v_credits numeric; v_max numeric; v_new numeric;
begin
  if not (coalesce(app.is_office(), false) or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.semester where id = p_semester and school_id = v_school) then raise exception 'Unknown semester'; end if;
  select * into st from public.student_semester(p_student, p_semester);
  select * into pc from public.programme_course where id = p_pc and school_id = v_school;
  if pc.id is null or st.programme_id is distinct from pc.programme_id or st.semester_no <> pc.semester_no then raise exception 'This course is not in the student''s semester'; end if;
  perform pg_advisory_xact_lock(hashtextextended('course_seat:' || p_semester || ':' || p_pc, 0));
  if pc.seat_limit is not null then
    select count(*) into v_used from public.course_registration where semester_id = p_semester and programme_course_id = p_pc and status <> 'dropped' and student_id <> p_student;
    if v_used >= pc.seat_limit then raise exception 'This course is full (% seats)', pc.seat_limit; end if;
  end if;
  -- one course per choice group: a new choice replaces the old one
  if pc.elective_group is not null then
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
revoke all on function public.register_course(bigint, bigint, bigint) from public, anon;
grant execute on function public.register_course(bigint, bigint, bigint) to authenticated;

create or replace function public.drop_course(p_semester bigint, p_student bigint, p_pc bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(app.is_office(), false) or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
  if exists (select 1 from public.programme_course where id = p_pc and elective_group is null) and not coalesce(app.is_office(), false) then raise exception 'Core courses cannot be dropped'; end if;
  update public.course_registration set status = 'dropped' where semester_id = p_semester and student_id = p_student and programme_course_id = p_pc and school_id = public.current_school_id();
end $$;
revoke all on function public.drop_course(bigint, bigint, bigint) from public, anon;
grant execute on function public.drop_course(bigint, bigint, bigint) to authenticated;

-- the office registers every student for the core courses of their semester
create or replace function public.register_core_courses(p_semester bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can do this'; end if;
  with ins as (
    insert into public.course_registration (school_id, semester_id, student_id, programme_course_id, status)
    select v_school, s.id, e.student_id, pc.id, 'approved'
    from public.semester s
    join public.student_enrollment e on e.academic_year_id = s.academic_year_id and e.status = 'active' and e.school_id = v_school
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id and c.programme_id is not null
    join public.programme_course pc on pc.programme_id = c.programme_id and pc.elective_group is null
      and pc.semester_no = 2 * c.year_no - case when s.kind = 'odd' then 1 else 0 end
    where s.id = p_semester and s.school_id = v_school
    on conflict do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.register_core_courses(bigint) from public, anon;
grant execute on function public.register_core_courses(bigint) to authenticated;

create or replace function public.approve_registrations(p_semester bigint, p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  with u as (update public.course_registration set status = 'approved' where semester_id = p_semester and id = any(p_ids) and status = 'registered'
             and school_id = public.current_school_id() and coalesce(app.is_office(), false) returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.approve_registrations(bigint, bigint[]) from public, anon;
grant execute on function public.approve_registrations(bigint, bigint[]) to authenticated;
commit;
