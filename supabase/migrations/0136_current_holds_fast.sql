-- The held-students list in one pass (0134 worked student by student).
begin;
create or replace function public.current_holds(p_section bigint default null)
returns table (student_id bigint, student_name text, admission_no text, section_label text, kind text, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; sc public.school; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_end date; v_admin boolean;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  select * into sc from public.school where id = v_school;
  if s.id is null or app.my_staff_id() is null then return; end if;
  v_admin := coalesce(app.is_admin_scope(), false);
  v_end := coalesce(case when sc.attendance_lock_mode in ('cutoff', 'both') then s.attendance_cutoff end, s.ends_on);
  return query
  with studs as (
    select e.student_id sid, st.full_name, st.admission_no, c.name || '-' || sec.name lbl
    from public.student_enrollment e join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    where e.school_id = v_school and e.academic_year_id = s.academic_year_id and e.status = 'active'
      and (p_section is null or e.section_id = p_section)
      and (v_admin or app.ct_of_section(e.section_id, s.academic_year_id))),
  per_course as (
    select a.student_id sid, sb.name sname, round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1) pct, a.subject_id
    from public.attendance_record a join studs on studs.sid = a.student_id join public.subject sb on sb.id = a.subject_id
    where a.period is not null and a.subject_id is not null and a.on_date between s.starts_on and v_end
    group by a.student_id, a.subject_id, sb.name),
  short as (
    select p.sid, string_agg(p.sname || ' (' || p.pct || '%)', ', ' order by p.sname) why
    from per_course p
    where p.pct < sc.attendance_minimum
      and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = s.id and cd.student_id = p.sid and cd.subject_id = p.subject_id)
    group by p.sid),
  dues as (
    select i.student_id sid, sum(i.amount - coalesce(i.paid_amount, 0)) bal
    from public.fee_invoice i join studs on studs.sid = i.student_id
    where v_admin and i.status in ('due', 'part') and i.due_date < v_today
      and not exists (select 1 from public.relaxation_request r where r.kind = 'fees' and r.student_id = i.student_id and r.status = 'approved' and r.until >= v_today)
    group by i.student_id having sum(i.amount - coalesce(i.paid_amount, 0)) > 0)
  select st.sid, st.full_name, st.admission_no, st.lbl, 'attendance'::text, 'Below ' || sc.attendance_minimum || '% in ' || sh.why
  from studs st join short sh on sh.sid = st.sid
  union all
  select st.sid, st.full_name, st.admission_no, st.lbl, 'fees'::text, 'Fees overdue: Rs ' || to_char(d.bal, 'FM99,99,99,990.00')
  from studs st join dues d on d.sid = st.sid
  order by 4, 2, 5;
end $$;
grant execute on function public.current_holds(bigint) to authenticated;
commit;
