-- Inter-campus transfer after review: safe parent matching, no silent CGPA change,
-- no-dues check, same programme, register number and identity carried, a private log.
begin;
alter table public.student_transfer add column if not exists student_name text, add column if not exists admission_no text,
  add column if not exists cgpa_before numeric(4,2), add column if not exists cgpa_after numeric(4,2);
alter table public.student_transfer alter column from_student drop not null, alter column to_student drop not null;
alter table public.student_transfer drop constraint if exists student_transfer_from_student_fkey, drop constraint if exists student_transfer_to_student_fkey;
alter table public.student_transfer add constraint student_transfer_from_student_fkey foreign key (from_student) references public.student(id) on delete set null,
  add constraint student_transfer_to_student_fkey foreign key (to_student) references public.student(id) on delete set null;
drop policy if exists st_read on public.student_transfer;
create policy st_read on public.student_transfer for select to authenticated
  using (university_id = (select public.current_university_id())
     or ((from_school = (select public.current_school_id()) or to_school = (select public.current_school_id())) and (select coalesce(app.is_admin_scope(), false))));
revoke all on function public.campus_sections(bigint) from public, anon;
grant execute on function public.campus_sections(bigint) to authenticated;

-- who the admission number belongs to, before an irreversible move
create or replace function public.campus_student(p_school bigint, p_admission_no text)
returns table (full_name text, class_label text, status text)
language sql stable security definer set search_path = '' as $$
  select st.full_name, (select c.name || '-' || sec.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                        where e.student_id = st.id order by (e.status = 'active') desc, e.academic_year_id desc limit 1), st.status
  from public.student st where st.school_id = p_school and st.admission_no = trim(p_admission_no) and app.is_central_for(p_school);
$$;
revoke all on function public.campus_student(bigint, text) from public, anon;
grant execute on function public.campus_student(bigint, text) to authenticated;

drop function if exists public.transfer_student(bigint, text, bigint, bigint, text);
drop function if exists public.transfer_student(bigint, text, bigint, bigint, text, boolean);
create function public.transfer_student(p_from bigint, p_admission_no text, p_to bigint, p_section bigint, p_note text default null, p_allow_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.student; v_new bigint; v_adm text; v_year bigint; v_carried int; v_missing text; v_uni bigint; g record; v_g bigint; v_dues text; v_i int := 1;
  v_from_prog text; v_to_prog text; v_before numeric; v_after numeric;
begin
  if p_from = p_to or not app.is_central_for(p_from) or not app.is_central_for(p_to) then raise exception 'Only central administration can transfer between two of its campuses'; end if;
  select * into s from public.student where school_id = p_from and admission_no = trim(p_admission_no) for update;
  if s.id is null then raise exception 'No student with that admission number at this campus'; end if;
  if s.status <> 'active' then raise exception 'This student is not studying here now'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = p_to) then raise exception 'Choose a section at the new campus'; end if;
  select id into v_year from public.academic_year where school_id = p_to and is_current;
  if v_year is null then raise exception 'The new campus has no current academic year'; end if;
  -- the same programme
  select pg.code into v_from_prog from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme pg on pg.id = c.programme_id where e.student_id = s.id and e.status = 'active' limit 1;
  select pg.code into v_to_prog from public.section sec join public.class c on c.id = sec.class_id join public.programme pg on pg.id = c.programme_id where sec.id = p_section;
  if v_from_prog is not null and v_to_prog is distinct from v_from_prog then raise exception 'A transfer keeps the programme: choose a % section at the new campus', v_from_prog; end if;
  -- nothing left open at this campus
  select string_agg(x, '; ') into v_dues from (
    select 'fees due' x where exists (select 1 from public.fee_invoice i where i.student_id = s.id and i.status in ('due', 'part'))
    union all select 'library books not returned' where exists (select 1 from public.library_issue l where l.student_id = s.id and l.returned_on is null)
    union all select 'hostel room not vacated' where exists (select 1 from public.hostel_allocation h where h.student_id = s.id and (h.to_date is null or h.to_date >= current_date))
    union all select 'malpractice report open' where exists (select 1 from public.exam_incident i where i.student_id = s.id and i.status = 'open')
    union all select 'revaluation pending' where exists (select 1 from public.reval_request r where r.student_id = s.id and r.status = 'pending')
    union all select 'supplementary exam pending' where exists (select 1 from public.supp_registration r where r.student_id = s.id and r.status in ('pending', 'registered') and r.result_id is null)
    union all select 'answer scripts still in valuation' where exists (select 1 from public.exam_script x where x.student_id = s.id and x.status <> 'decoded')) d;
  if v_dues is not null then raise exception 'Clear these at this campus first: %', v_dues; end if;
  -- grades that cannot be carried: refuse unless asked to go ahead (CGPA would change)
  select string_agg(distinct fc.code || coalesce(' (' || fy.name || ')', ''), ', ') into v_missing
  from public.course_result cr join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  where cr.student_id = s.id and (not exists (select 1 from public.course tc where tc.school_id = p_to and tc.code = fc.code)
     or not exists (select 1 from public.academic_year ty join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind where ty.school_id = p_to and ty.name = fy.name));
  if v_missing is not null and not coalesce(p_allow_partial, false) then
    raise exception 'These results have no matching course or semester at the new campus, so CGPA would change: %. Copy the catalogue first, or transfer anyway.', left(v_missing, 300);
  end if;
  select cgpa into v_before from public.student_standing(s.id);
  select university_id into v_uni from public.school where id = p_from;

  v_adm := s.admission_no;
  while exists (select 1 from public.student where school_id = p_to and admission_no = v_adm) loop
    v_adm := left(s.admission_no, 24) || '-TR' || case when v_i > 1 then v_i::text else '' end; v_i := v_i + 1;
  end loop;
  insert into public.student (school_id, admission_no, full_name, dob, gender, photo_path, email, phone, status, university_reg_no)
  values (p_to, v_adm, s.full_name, s.dob, s.gender, s.photo_path, s.email, s.phone, 'active', s.university_reg_no) returning id into v_new;
  insert into public.student_identity (student_id, school_id, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl)
  select v_new, p_to, apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl from public.student_identity where student_id = s.id
  on conflict do nothing;
  insert into public.student_enrollment (school_id, student_id, academic_year_id, section_id, status) values (p_to, v_new, v_year, p_section, 'active');

  -- parents come along: the parent's existing record at the new campus (by login, phone or email), else a new one
  for g in select gu.*, gs.is_primary from public.guardian_student gs join public.guardian gu on gu.id = gs.guardian_id where gs.student_id = s.id loop
    select m2.guardian_id into v_g from public.person_membership m1 join public.person_membership m2 on m2.user_id = m1.user_id and m2.school_id = p_to and m2.role = 'guardian'
      where m1.guardian_id = g.id limit 1;
    if v_g is null then
      select x.id into v_g from public.guardian x where x.school_id = p_to
        and ((nullif(trim(g.phone), '') is not null and x.phone = g.phone) or (nullif(trim(g.email), '') is not null and lower(x.email) = lower(g.email))) limit 1;
    end if;
    if v_g is null then
      insert into public.guardian (school_id, full_name, relation, email, phone) values (p_to, g.full_name, g.relation, g.email, g.phone) returning id into v_g;
    end if;
    insert into public.guardian_student (school_id, guardian_id, student_id, is_primary) values (p_to, v_g, v_new, g.is_primary) on conflict do nothing;
    insert into public.person_membership (user_id, school_id, role, guardian_id)
    select m.user_id, p_to, 'guardian', v_g from public.person_membership m where m.guardian_id = g.id
    on conflict do nothing;
    v_g := null;
  end loop;
  insert into public.person_membership (user_id, school_id, role, student_id)
  select m.user_id, p_to, 'student', v_new from public.person_membership m where m.student_id = s.id
  on conflict (user_id, school_id, role) do update set student_id = excluded.student_id;
  update public.profile set school_id = p_to, student_id = v_new where student_id = s.id and role::text = 'student';

  with m as (
    select cr.*, tc.id to_course, ts.id to_sem from public.course_result cr
    join public.course fc on fc.id = cr.course_id join public.semester fs on fs.id = cr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
    left join public.course tc on tc.school_id = p_to and tc.code = fc.code
    left join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name
    left join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
    where cr.student_id = s.id),
  ins as (insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed, published_at, kind, counts, grace)
          select p_to, m.to_sem, v_new, m.to_course, m.attempt, m.credits, m.cia, m.cia_max, m.ese, m.ese_max, m.percent, m.grade, m.point, m.passed, m.published_at, m.kind, m.counts, m.grace
          from m where m.to_course is not null and m.to_sem is not null returning 1)
  select count(*) into v_carried from ins;
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_at, withheld_reason, published_as)
  select p_to, ts.id, v_new, sr.semester_no, sr.credits_registered, sr.credits_earned, sr.sgpa, sr.cgpa, sr.backlogs, sr.published_at, sr.withheld_reason, coalesce(sr.published_as, '') || ' (transferred)'
  from public.semester_result sr join public.semester fs on fs.id = sr.semester_id join public.academic_year fy on fy.id = fs.academic_year_id
  join public.academic_year ty on ty.school_id = p_to and ty.name = fy.name join public.semester ts on ts.academic_year_id = ty.id and ts.kind = fs.kind and ts.school_id = p_to
  where sr.student_id = s.id
  on conflict (semester_id, student_id) do nothing;
  perform public.refresh_cgpa(array[v_new]);
  select cgpa into v_after from public.semester_result sr join public.semester sm on sm.id = sr.semester_id where sr.student_id = v_new order by sm.starts_on desc limit 1;

  update public.student_transport set is_active = false where student_id = s.id and is_active;
  update public.student set status = 'transferred', left_on = current_date, exit_remark = left('Transferred to ' || (select name from public.school where id = p_to), 200) where id = s.id;
  update public.student_enrollment set status = 'transferred' where student_id = s.id and status = 'active';
  insert into public.student_transfer (university_id, from_school, from_student, to_school, to_student, carried, not_carried, note, done_by, student_name, admission_no, cgpa_before, cgpa_after)
  values (v_uni, p_from, s.id, p_to, v_new, v_carried, v_missing, left(nullif(trim(coalesce(p_note, '')), ''), 300), auth.uid(), s.full_name, v_adm, v_before, v_after);
  return jsonb_build_object('student_id', v_new, 'admission_no', v_adm, 'carried', v_carried, 'not_carried', v_missing, 'cgpa_before', v_before, 'cgpa_after', v_after);
end $$;
revoke all on function public.transfer_student(bigint, text, bigint, bigint, text, boolean) from public, anon;
grant execute on function public.transfer_student(bigint, text, bigint, bigint, text, boolean) to authenticated;
commit;
notify pgrst, 'reload schema';
