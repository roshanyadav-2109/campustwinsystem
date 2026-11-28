-- Medicine log (schools): medicines a parent asks the school to give (with consent), what is due today, and
-- each dose given, refused or missed; the family is told when a dose is recorded.
begin;
create table if not exists public.student_medicine (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id   bigint not null references public.student(id) on delete cascade,
  medicine     text not null check (char_length(medicine) between 2 and 80),
  dose         text not null check (char_length(dose) between 1 and 60),
  times        time[] not null check (cardinality(times) between 1 and 6),
  from_date    date not null,
  to_date      date not null,
  instructions text check (instructions is null or char_length(instructions) <= 300),
  doctor       text check (doctor is null or char_length(doctor) <= 80),
  consent      boolean not null default false,
  added_by     uuid,
  status       text not null default 'active' check (status in ('active', 'stopped')),
  created_at   timestamptz not null default now(),
  check (to_date >= from_date and to_date <= from_date + 366)
);
create index if not exists idx_student_medicine_active on public.student_medicine (school_id, to_date) where status = 'active';
create table if not exists public.medicine_dose (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  medicine_id bigint not null references public.student_medicine(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  due_on      date not null,
  due_at      time not null,
  status      text not null check (status in ('given', 'refused', 'missed')),
  note        text check (note is null or char_length(note) <= 200),
  given_at    timestamptz not null default now(),
  given_by    bigint references public.staff(id) on delete set null,
  unique (medicine_id, due_on, due_at)
);
create index if not exists idx_medicine_dose_student on public.medicine_dose (student_id, given_at desc);
do $$ declare t text;
begin
  foreach t in array array['student_medicine', 'medicine_dose'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists med_read on public.%I', t);
    execute format('create policy med_read on public.%I for select to authenticated using ((select app.is_admin_scope()) or app.owns_student(student_id) or public.staff_sees_student(student_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- a parent (for their own child, with consent) or the office adds a medicine
create or replace function public.add_medicine(p_student bigint, p_medicine text, p_dose text, p_times time[], p_from date, p_to date, p_instructions text, p_doctor text, p_consent boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not exists (select 1 from public.student where id = p_student and school_id = public.current_school_id()) then raise exception 'Unknown student'; end if;
  if not (app.owns_student(p_student) or coalesce(app.is_admin_scope(), false)) then raise exception 'Only the family or the office can add a medicine'; end if;
  if not coalesce(p_consent, false) then raise exception 'The parent''s consent is needed for the school to give a medicine'; end if;
  if p_to < p_from then raise exception 'The last day is before the first'; end if;
  insert into public.student_medicine (student_id, medicine, dose, times, from_date, to_date, instructions, doctor, consent, added_by)
  values (p_student, left(trim(p_medicine), 80), left(trim(p_dose), 60), (select array_agg(distinct t order by t) from unnest(p_times) t), p_from, p_to,
          left(nullif(trim(p_instructions), ''), 300), left(nullif(trim(p_doctor), ''), 80), true, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_medicine(bigint, text, text, time[], date, date, text, text, boolean) from public, anon;
grant execute on function public.add_medicine(bigint, text, text, time[], date, date, text, text, boolean) to authenticated;

create or replace function public.stop_medicine(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.student_medicine;
begin
  select * into m from public.student_medicine where id = p_id and school_id = public.current_school_id();
  if m.id is null or not (app.owns_student(m.student_id) or coalesce(app.is_admin_scope(), false)) then raise exception 'Not allowed'; end if;
  update public.student_medicine set status = 'stopped' where id = m.id;
end $$;
revoke all on function public.stop_medicine(bigint) from public, anon;
grant execute on function public.stop_medicine(bigint) to authenticated;

-- today's doses: each active medicine at each of its times, with what was recorded
create or replace function public.medicine_due(p_day date default null)
returns table (medicine_id bigint, student_id bigint, student_name text, class_label text, medicine text, dose text, due_at time, instructions text, allergies text, status text, given_by text, note text)
language sql stable security definer set search_path = '' as $$
  with d as (select coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date) dd)
  select m.id, m.student_id, st.full_name,
    (select c.name || '-' || sec.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
      where e.student_id = st.id and e.status = 'active' order by e.academic_year_id desc limit 1),
    m.medicine, m.dose, t.at, m.instructions, (select p.allergies from public.student_profile p where p.student_id = st.id),
    x.status, (select s.full_name from public.staff s where s.id = x.given_by), x.note
  from public.student_medicine m cross join d cross join lateral unnest(m.times) t(at)
  join public.student st on st.id = m.student_id
  left join public.medicine_dose x on x.medicine_id = m.id and x.due_on = d.dd and x.due_at = t.at
  where m.school_id = public.current_school_id() and m.status = 'active' and d.dd between m.from_date and m.to_date
    and (coalesce(app.is_admin_scope(), false) or public.staff_sees_student(m.student_id))
  order by t.at, st.full_name;
$$;
revoke all on function public.medicine_due(date) from public, anon;
grant execute on function public.medicine_due(date) to authenticated;

-- a dose is recorded by staff (office, principal, or the student's class teacher); the family is told
create or replace function public.record_dose(p_medicine bigint, p_at time, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.student_medicine; v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into m from public.student_medicine where id = p_medicine and school_id = public.current_school_id() and status = 'active';
  if m.id is null or v_day not between m.from_date and m.to_date or not (p_at = any(m.times)) then raise exception 'This dose is not due today'; end if;
  if not (coalesce(app.is_admin_scope(), false) or public.staff_sees_student(m.student_id)) or app.my_staff_id() is null then raise exception 'Only school staff can record a dose'; end if;
  if p_status not in ('given', 'refused', 'missed') then raise exception 'Given, refused or missed'; end if;
  insert into public.medicine_dose (school_id, medicine_id, student_id, due_on, due_at, status, note, given_by)
  values (m.school_id, m.id, m.student_id, v_day, p_at, p_status, left(nullif(trim(p_note), ''), 200), app.my_staff_id())
  on conflict (medicine_id, due_on, due_at) do update set status = excluded.status, note = excluded.note, given_by = excluded.given_by, given_at = now();
  perform public.notify_family(m.school_id, 'health_visit', 'dose:' || m.id || ':' || v_day || ':' || p_at, m.student_id,
    jsonb_build_object('med', m.medicine, 'dose', m.dose, 'at', to_char(p_at, 'HH24:MI'), 'what', case p_status when 'given' then 'was given' when 'refused' then 'was refused by the child' else 'was missed' end),
    'Medicine at school', '{med} ({dose}) due at {at} {what}.', '/dashboard/front-desk');
end $$;
revoke all on function public.record_dose(bigint, time, text, text) from public, anon;
grant execute on function public.record_dose(bigint, time, text, text) to authenticated;
commit;
notify pgrst, 'reload schema';
