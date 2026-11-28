-- Timetable generator (schools): what each class needs per week, when teachers are not available,
-- and saving a generated week for many sections at once (checked for teacher clashes).
begin;
create table if not exists public.timetable_load (
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  class_id         bigint not null references public.class(id) on delete cascade,
  subject_id       bigint not null references public.subject(id) on delete cascade,
  periods          smallint not null check (periods between 0 and 40),
  double_period    boolean not null default false,
  max_per_day      smallint check (max_per_day is null or max_per_day between 1 and 8),
  primary key (academic_year_id, class_id, subject_id)
);
create table if not exists public.staff_unavailable (
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  staff_id    bigint not null references public.staff(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 6),
  period_no   smallint not null check (period_no between 1 and 20),
  primary key (staff_id, day_of_week, period_no)
);
do $$ declare t text;
begin
  foreach t in array array['timetable_load', 'staff_unavailable'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists tt_read on public.%I', t);
    execute format('create policy tt_read on public.%I for select to authenticated using ((select app.is_admin_scope()))', t);
    execute format('drop policy if exists tt_write on public.%I', t);
    execute format('create policy tt_write on public.%I for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
alter table public.school add column if not exists tt_days smallint[] not null default '{1,2,3,4,5,6}' check (tt_days <@ '{1,2,3,4,5,6}'::smallint[] and cardinality(tt_days) >= 1),
  add column if not exists tt_teacher_max_day smallint not null default 6 check (tt_teacher_max_day between 1 and 12),
  add column if not exists tt_class_teacher_first boolean not null default true;

create or replace function public.set_timetable_rules(p_days smallint[], p_max int, p_ct_first boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change this'; end if;
  update public.school set tt_days = (select array_agg(distinct d order by d) from unnest(p_days) d), tt_teacher_max_day = p_max, tt_class_teacher_first = coalesce(p_ct_first, true)
   where id = public.current_school_id();
end $$;
revoke all on function public.set_timetable_rules(smallint[], int, boolean) from public, anon;
grant execute on function public.set_timetable_rules(smallint[], int, boolean) to authenticated;

-- a generated week for these sections replaces their lessons in one step; refused if any teacher ends up in two places
create or replace function public.save_generated_timetable(p_year bigint, p_sections bigint[], p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int; v_clash text;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change the timetable'; end if;
  if not exists (select 1 from public.academic_year where id = p_year and school_id = v_school) then raise exception 'Unknown year'; end if;
  if exists (select 1 from unnest(p_sections) x where not exists (select 1 from public.section s where s.id = x and s.school_id = v_school)) then raise exception 'Unknown section'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Too many lessons at once'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as r(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint)
             where r.section_id <> all(p_sections) or r.day not between 1 and 6 or r.period not between 1 and 20) then
    raise exception 'A lesson is outside the chosen sections or the week';
  end if;
  delete from public.timetable_slot where academic_year_id = p_year and section_id = any(p_sections);
  insert into public.timetable_slot (school_id, academic_year_id, section_id, day_of_week, period_no, subject_id, staff_id)
  select v_school, p_year, r.section_id, r.day, r.period, r.subject_id, r.staff_id
  from jsonb_to_recordset(p_rows) as r(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint);
  get diagnostics n = row_count;
  -- no teacher of these sections in two places at once
  select string_agg(distinct st.full_name || ' (day ' || x.day_of_week || ', period ' || x.period_no || ')', ', ') into v_clash
  from (select staff_id, day_of_week, period_no from public.timetable_slot where academic_year_id = p_year and staff_id is not null
        group by 1, 2, 3 having count(*) > 1 and bool_or(section_id = any(p_sections))) x join public.staff st on st.id = x.staff_id;
  if v_clash is not null then raise exception 'A teacher would be in two classes at once: %', left(v_clash, 300); end if;
  return n;
end $$;
revoke all on function public.save_generated_timetable(bigint, bigint[], jsonb) from public, anon;
grant execute on function public.save_generated_timetable(bigint, bigint[], jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
