-- Timetable generator after review: lesson groups (combined classes, split groups such as languages),
-- rooms, shorter days and blocked periods, a safe save (upsert, substitutions and rooms kept), ownership checks.
begin;
-- ---------- lesson groups ----------
create table if not exists public.timetable_group (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  label            text not null check (char_length(label) between 1 and 60),
  section_ids      bigint[] not null check (cardinality(section_ids) between 1 and 12),
  periods          smallint not null check (periods between 1 and 20),
  double_period    boolean not null default false,
  max_per_day      smallint check (max_per_day is null or max_per_day between 1 and 8),
  room             text check (room is null or char_length(room) <= 40)
);
create table if not exists public.timetable_group_item (
  group_id   bigint not null references public.timetable_group(id) on delete cascade,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  subject_id bigint not null references public.subject(id) on delete cascade,
  staff_id   bigint references public.staff(id) on delete set null,
  primary key (group_id, subject_id)
);
-- the other subjects and teachers of a split lesson (the slot holds the first)
create table if not exists public.timetable_slot_extra (
  slot_id    bigint not null references public.timetable_slot(id) on delete cascade,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  subject_id bigint not null references public.subject(id) on delete cascade,
  staff_id   bigint references public.staff(id) on delete set null,
  primary key (slot_id, subject_id)
);
create index if not exists idx_slot_extra_staff on public.timetable_slot_extra (staff_id);
alter table public.timetable_slot add column if not exists group_id bigint references public.timetable_group(id) on delete set null;
alter table public.timetable_load add column if not exists room text check (room is null or char_length(room) <= 40);
alter table public.school add column if not exists tt_day_periods jsonb not null default '{}'::jsonb,
  add column if not exists tt_blocked jsonb not null default '[]'::jsonb;

do $$ declare t text;
begin
  foreach t in array array['timetable_group', 'timetable_group_item'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists tt_read on public.%I', t);
    execute format('create policy tt_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists tt_write on public.%I', t);
    execute format('create policy tt_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
alter table public.timetable_slot_extra enable row level security;
drop policy if exists tenant_isolation on public.timetable_slot_extra;
create policy tenant_isolation on public.timetable_slot_extra as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists tx_read on public.timetable_slot_extra;
create policy tx_read on public.timetable_slot_extra for select to authenticated using (true);
revoke all on public.timetable_slot_extra from anon, authenticated;
grant select on public.timetable_slot_extra to authenticated;
grant all on public.timetable_slot_extra to service_role;

-- rows must point at this institution's own classes, subjects, staff and years
create or replace function public.tt_owner_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'class_id' and not exists (select 1 from public.class where id = (j ->> 'class_id')::bigint and school_id = new.school_id) then raise exception 'Unknown class'; end if;
  if j ? 'subject_id' and not exists (select 1 from public.subject where id = (j ->> 'subject_id')::bigint and school_id = new.school_id) then raise exception 'Unknown subject'; end if;
  if j ? 'staff_id' and j ->> 'staff_id' is not null and not exists (select 1 from public.staff where id = (j ->> 'staff_id')::bigint and school_id = new.school_id) then raise exception 'Unknown staff member'; end if;
  if j ? 'academic_year_id' and not exists (select 1 from public.academic_year where id = (j ->> 'academic_year_id')::bigint and school_id = new.school_id) then raise exception 'Unknown year'; end if;
  if j ? 'section_ids' and exists (select 1 from unnest(new.section_ids) x where not exists (select 1 from public.section s where s.id = x and s.school_id = new.school_id)) then raise exception 'Unknown section'; end if;
  if j ? 'group_id' and j ->> 'group_id' is not null and not exists (select 1 from public.timetable_group g where g.id = (j ->> 'group_id')::bigint and g.school_id = new.school_id) then raise exception 'Unknown group'; end if;
  return new;
end $$;
do $$ declare t text;
begin
  foreach t in array array['timetable_load', 'staff_unavailable', 'timetable_group', 'timetable_group_item', 'timetable_slot_extra'] loop
    execute format('drop trigger if exists trg_tt_owner on public.%I', t);
    execute format('create trigger trg_tt_owner before insert or update on public.%I for each row execute function public.tt_owner_guard()', t);
  end loop;
end $$;

create or replace function public.set_timetable_shape(p_day_periods jsonb, p_blocked jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change this'; end if;
  if jsonb_typeof(coalesce(p_day_periods, '{}')) <> 'object' or jsonb_typeof(coalesce(p_blocked, '[]')) <> 'array' or jsonb_array_length(coalesce(p_blocked, '[]')) > 200 then raise exception 'Bad shape'; end if;
  update public.school set tt_day_periods = coalesce(p_day_periods, '{}'), tt_blocked = coalesce(p_blocked, '[]') where id = public.current_school_id();
end $$;
revoke all on function public.set_timetable_shape(jsonb, jsonb) from public, anon;
grant execute on function public.set_timetable_shape(jsonb, jsonb) to authenticated;

-- ---------- saving a generated week ----------
-- cells are updated in place (substitutions and rooms stay with them); only cells no longer used are removed;
-- a teacher may be in several sections at once only in one combined lesson (the same group)
drop function if exists public.save_generated_timetable(bigint, bigint[], jsonb);
create function public.save_generated_timetable(p_year bigint, p_sections bigint[], p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int; v_clash text;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change the timetable'; end if;
  if p_sections is null or cardinality(p_sections) = 0 then raise exception 'Choose the sections'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'No lessons'; end if;
  if not exists (select 1 from public.academic_year where id = p_year and school_id = v_school) then raise exception 'Unknown year'; end if;
  if exists (select 1 from unnest(p_sections) x where not exists (select 1 from public.section s where s.id = x and s.school_id = v_school)) then raise exception 'Unknown section'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Too many lessons at once'; end if;
  if exists (select 1 from (select x.section_id, x.day, x.period, x.subject_id, x.staff_id, nullif(left(trim(x.room), 40), '') room, x.group_id, coalesce(x.extras, '[]'::jsonb) extras from jsonb_to_recordset(p_rows) as x(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint, room text, group_id bigint, extras jsonb)) r where r.section_id <> all(p_sections) or r.day not between 1 and 6
             or not exists (select 1 from public.timetable_period tp where tp.school_id = v_school and tp.period_no = r.period and not tp.is_break)) then
    raise exception 'A lesson is outside the chosen sections or the teaching periods';
  end if;
  if exists (select 1 from (select x.section_id, x.day, x.period, x.subject_id, x.staff_id, nullif(left(trim(x.room), 40), '') room, x.group_id, coalesce(x.extras, '[]'::jsonb) extras from jsonb_to_recordset(p_rows) as x(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint, room text, group_id bigint, extras jsonb)) r where (r.subject_id is not null and not exists (select 1 from public.subject s where s.id = r.subject_id and s.school_id = v_school))
             or (r.staff_id is not null and not exists (select 1 from public.staff s where s.id = r.staff_id and s.school_id = v_school))
             or (r.group_id is not null and not exists (select 1 from public.timetable_group g where g.id = r.group_id and g.school_id = v_school))) then
    raise exception 'A subject, teacher or group is not of this institution';
  end if;
  delete from public.timetable_slot t where t.academic_year_id = p_year and t.section_id = any(p_sections)
    and not exists (select 1 from (select x.section_id, x.day, x.period, x.subject_id, x.staff_id, nullif(left(trim(x.room), 40), '') room, x.group_id, coalesce(x.extras, '[]'::jsonb) extras from jsonb_to_recordset(p_rows) as x(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint, room text, group_id bigint, extras jsonb)) r where r.section_id = t.section_id and r.day = t.day_of_week and r.period = t.period_no);
  insert into public.timetable_slot (school_id, academic_year_id, section_id, day_of_week, period_no, subject_id, staff_id, room, group_id)
  select v_school, p_year, r.section_id, r.day, r.period, r.subject_id, r.staff_id, r.room, r.group_id from (select x.section_id, x.day, x.period, x.subject_id, x.staff_id, nullif(left(trim(x.room), 40), '') room, x.group_id, coalesce(x.extras, '[]'::jsonb) extras from jsonb_to_recordset(p_rows) as x(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint, room text, group_id bigint, extras jsonb)) r
  on conflict (academic_year_id, section_id, day_of_week, period_no) do update
    set subject_id = excluded.subject_id, staff_id = excluded.staff_id, group_id = excluded.group_id, room = coalesce(excluded.room, public.timetable_slot.room);
  get diagnostics n = row_count;
  delete from public.timetable_slot_extra x using public.timetable_slot t where t.id = x.slot_id and t.academic_year_id = p_year and t.section_id = any(p_sections);
  insert into public.timetable_slot_extra (slot_id, school_id, subject_id, staff_id)
  select t.id, v_school, (e ->> 'subject_id')::bigint, nullif(e ->> 'staff_id', '')::bigint
  from (select x.section_id, x.day, x.period, x.subject_id, x.staff_id, nullif(left(trim(x.room), 40), '') room, x.group_id, coalesce(x.extras, '[]'::jsonb) extras from jsonb_to_recordset(p_rows) as x(section_id bigint, day smallint, period smallint, subject_id bigint, staff_id bigint, room text, group_id bigint, extras jsonb)) r join public.timetable_slot t on t.academic_year_id = p_year and t.section_id = r.section_id and t.day_of_week = r.day and t.period_no = r.period
  cross join jsonb_array_elements(r.extras) e
  on conflict do nothing;
  -- no teacher of these sections in two lessons at once (one combined lesson across sections is one lesson)
  with busy as (
    select t.staff_id, t.day_of_week d, t.period_no p, coalesce('g' || t.group_id, 's' || t.id) lesson, t.section_id from public.timetable_slot t
     where t.academic_year_id = p_year and t.staff_id is not null and t.school_id = v_school
    union all
    select x.staff_id, t.day_of_week, t.period_no, coalesce('g' || t.group_id, 's' || t.id), t.section_id from public.timetable_slot_extra x join public.timetable_slot t on t.id = x.slot_id
     where t.academic_year_id = p_year and x.staff_id is not null and t.school_id = v_school)
  select string_agg(distinct st.full_name || ' (day ' || b.d || ', period ' || b.p || ')', ', ') into v_clash
  from (select staff_id, d, p from busy group by 1, 2, 3 having count(distinct lesson) > 1 and bool_or(section_id = any(p_sections))) b
  join public.staff st on st.id = b.staff_id and st.school_id = v_school;
  if v_clash is not null then raise exception 'A teacher would be in two classes at once: %', left(v_clash, 300); end if;
  return n;
end $$;
revoke all on function public.save_generated_timetable(bigint, bigint[], jsonb) from public, anon;
grant execute on function public.save_generated_timetable(bigint, bigint[], jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
