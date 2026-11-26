-- Substitution: when a teacher is away, their lessons for the day are listed
-- with free teachers suggested (the subject's teachers and the section's own
-- teachers first, then the least busy). The office assigns; the substitute is
-- told. A substitute must be free in that period and not away themselves.
-- Away = marked absent or on leave in staff attendance, or approved leave.
begin;
create table if not exists public.substitution (
  id                  bigint generated always as identity primary key,
  school_id           bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  on_date             date not null,
  slot_id             bigint not null references public.timetable_slot(id) on delete cascade,
  absent_staff_id     bigint references public.staff(id) on delete set null,
  substitute_staff_id bigint not null references public.staff(id) on delete cascade,
  note                text check (note is null or char_length(note) <= 200),
  created_by          bigint references public.staff(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (on_date, slot_id)
);
create index if not exists idx_substitution_sub on public.substitution (substitute_staff_id, on_date);
alter table public.substitution enable row level security;
drop policy if exists tenant_isolation on public.substitution;
create policy tenant_isolation on public.substitution as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists sub_read on public.substitution;
create policy sub_read on public.substitution for select to authenticated
  using ((select app.is_admin_scope()) or substitute_staff_id = (select app.my_staff_id()) or absent_staff_id = (select app.my_staff_id()));
drop policy if exists sub_write on public.substitution;
create policy sub_write on public.substitution for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
revoke all on public.substitution from anon;
grant select, insert, update, delete on public.substitution to authenticated;
revoke truncate, trigger, references on public.substitution from authenticated;
grant all on public.substitution to service_role;

create or replace function public.staff_away(p_staff bigint, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_attendance a where a.staff_id = p_staff and a.on_date = p_date and a.status in ('absent', 'leave'))
      or exists (select 1 from public.staff_leave l where l.staff_id = p_staff and l.status = 'approved' and p_date between l.from_date and l.to_date);
$$;

-- lessons of away teachers on a day
create or replace function public.substitution_needs(p_date date)
returns table (slot_id bigint, period_no smallint, period_label text, start_time time, end_time time, section_label text, subject text,
               absent_staff_id bigint, absent_name text, substitute_id bigint, substitute_name text, substitution_id bigint)
language sql stable security definer set search_path = '' as $$
  select ts.id, ts.period_no, tp.label, tp.start_time, tp.end_time, c.name || '-' || sec.name, sb.name,
         st.id, st.full_name, sub.substitute_staff_id, ss.full_name, sub.id
  from public.timetable_slot ts
  join public.academic_year y on y.id = ts.academic_year_id and y.is_current
  join public.staff st on st.id = ts.staff_id
  join public.section sec on sec.id = ts.section_id join public.class c on c.id = sec.class_id
  left join public.subject sb on sb.id = ts.subject_id
  left join public.timetable_period tp on tp.school_id = ts.school_id and tp.period_no = ts.period_no
  left join public.substitution sub on sub.slot_id = ts.id and sub.on_date = p_date
  left join public.staff ss on ss.id = sub.substitute_staff_id
  where ts.school_id = public.current_school_id() and coalesce(app.is_admin_scope(), false)
    and ts.day_of_week = extract(isodow from p_date) and public.staff_away(ts.staff_id, p_date)
  order by ts.period_no, c.level, sec.name;
$$;
grant execute on function public.substitution_needs(date) to authenticated;

-- free teachers for one lesson, best first
create or replace function public.substitution_candidates(p_date date, p_slot bigint)
returns table (staff_id bigint, full_name text, teaches_subject boolean, teaches_section boolean, lessons_today int)
language sql stable security definer set search_path = '' as $$
  with slot as (select ts.* from public.timetable_slot ts where ts.id = p_slot and ts.school_id = public.current_school_id())
  select s.id, s.full_name,
    exists (select 1 from public.teacher_allotment ta, slot where ta.staff_id = s.id and ta.subject_id = slot.subject_id and ta.academic_year_id = slot.academic_year_id),
    exists (select 1 from public.teacher_allotment ta, slot where ta.staff_id = s.id and ta.section_id = slot.section_id and ta.academic_year_id = slot.academic_year_id),
    ((select count(*) from public.timetable_slot x, slot where x.staff_id = s.id and x.day_of_week = slot.day_of_week and x.academic_year_id = slot.academic_year_id)
     + (select count(*) from public.substitution x where x.substitute_staff_id = s.id and x.on_date = p_date))::int
  from public.staff s, slot
  where s.school_id = slot.school_id and coalesce(app.is_admin_scope(), false)
    and s.role::text in ('subject_teacher', 'class_teacher', 'principal')
    and s.id <> slot.staff_id
    and not public.staff_away(s.id, p_date)
    and not exists (select 1 from public.timetable_slot x where x.staff_id = s.id and x.day_of_week = slot.day_of_week and x.period_no = slot.period_no and x.academic_year_id = slot.academic_year_id)
    and not exists (select 1 from public.substitution x join public.timetable_slot xs on xs.id = x.slot_id where x.substitute_staff_id = s.id and x.on_date = p_date and xs.period_no = slot.period_no)
  order by 3 desc, 4 desc, 5, 2
  limit 30;
$$;
grant execute on function public.substitution_candidates(date, bigint) to authenticated;

insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('substitution', 'Substitution assigned (to the teacher)', true, '{}', 62)
on conflict (key) do update set label = excluded.label, urgent = excluded.urgent, sort = excluded.sort;

create or replace function public.substitution_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_slot public.timetable_slot; v_when text;
begin
  select * into v_slot from public.timetable_slot where id = new.slot_id;
  if v_slot.school_id is distinct from new.school_id or not exists (select 1 from public.staff s where s.id = new.substitute_staff_id and s.school_id = new.school_id) then
    raise exception 'That record belongs to another institution';
  end if;
  if extract(isodow from new.on_date) <> v_slot.day_of_week then raise exception 'That lesson is not on this day'; end if;
  if public.staff_away(new.substitute_staff_id, new.on_date) then raise exception 'This teacher is away that day'; end if;
  if exists (select 1 from public.timetable_slot x where x.staff_id = new.substitute_staff_id and x.day_of_week = v_slot.day_of_week and x.period_no = v_slot.period_no and x.academic_year_id = v_slot.academic_year_id)
     or exists (select 1 from public.substitution x join public.timetable_slot xs on xs.id = x.slot_id where x.substitute_staff_id = new.substitute_staff_id and x.on_date = new.on_date and xs.period_no = v_slot.period_no and x.id is distinct from new.id) then
    raise exception 'This teacher already has a lesson in that period';
  end if;
  new.absent_staff_id := v_slot.staff_id;
  return new;
end $$;
drop trigger if exists trg_substitution_guard on public.substitution;
create trigger trg_substitution_guard before insert or update on public.substitution for each row execute function public.substitution_guard();

create or replace function public.substitution_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  select jsonb_build_object('date', to_char(new.on_date, 'DD/MM/YYYY'), 'period', coalesce(tp.label, 'Period ' || ts.period_no), 'section', c.name || '-' || sec.name,
                            'subject', coalesce(sb.name, ''), 'teacher', coalesce(st.full_name, ''))
    into v from public.timetable_slot ts join public.section sec on sec.id = ts.section_id join public.class c on c.id = sec.class_id
    left join public.subject sb on sb.id = ts.subject_id left join public.staff st on st.id = ts.staff_id
    left join public.timetable_period tp on tp.school_id = ts.school_id and tp.period_no = ts.period_no
   where ts.id = new.slot_id;
  perform public.notify_safe(new.school_id, 'substitution', 'substitution:' || new.id || ':' || new.substitute_staff_id, null, new.substitute_staff_id, null, v,
    'Substitution: {section}, {period}', 'On {date}, please take {section} for {subject} in {period} (in place of {teacher}).', '/dashboard/schedule');
  return null;
exception when others then raise warning 'substitution_notify: %', sqlerrm; return null;
end $$;
drop trigger if exists trg_substitution_notify on public.substitution;
create trigger trg_substitution_notify after insert or update of substitute_staff_id on public.substitution for each row execute function public.substitution_notify();
commit;
