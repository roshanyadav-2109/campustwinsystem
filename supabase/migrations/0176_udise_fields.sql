-- UDISE+ complete: the student fields the portal asks for that were missing.
begin;
alter table public.student_identity
  add column if not exists aadhaar_name text check (aadhaar_name is null or char_length(aadhaar_name) <= 100),
  add column if not exists minority text check (minority is null or minority in ('none', 'muslim', 'christian', 'sikh', 'buddhist', 'parsi', 'jain')),
  add column if not exists disadvantaged boolean not null default false,
  add column if not exists aay boolean not null default false,
  add column if not exists disability_type text check (disability_type is null or char_length(disability_type) <= 60),
  add column if not exists udid_no text check (udid_no is null or udid_no ~ '^[A-Za-z0-9]{10,20}$'),
  add column if not exists rte_admission boolean not null default false;
alter table public.student_profile
  add column if not exists height_cm numeric(5,1) check (height_cm is null or height_cm between 40 and 250),
  add column if not exists weight_kg numeric(5,1) check (weight_kg is null or weight_kg between 5 and 200),
  add column if not exists medium text check (medium is null or char_length(medium) <= 40),
  add column if not exists stream text check (stream is null or stream in ('science', 'commerce', 'humanities', 'vocational')),
  add column if not exists prev_result text check (prev_result is null or prev_result in ('promoted', 'passed', 'failed', 'detained', 'new')),
  add column if not exists prev_percent numeric(5,2) check (prev_percent is null or prev_percent between 0 and 100),
  add column if not exists prev_attendance_days int check (prev_attendance_days is null or prev_attendance_days between 0 and 366),
  add column if not exists facilities text[] not null default '{}'
    check (facilities <@ array['free_textbooks', 'free_uniform', 'free_transport', 'free_escort', 'free_hostel', 'free_bicycle', 'free_laptop', 'scholarship', 'mid_day_meal']::text[]);

drop function if exists public.udise_student_rows(bigint);
create function public.udise_student_rows(p_section bigint default null)
returns table (admission_no text, student_name text, aadhaar_name text, gender text, dob date, class_name text, section_name text, roll_no int,
               admission_date date, mother_name text, father_name text, guardian_name text, mobile text, email text,
               address text, pincode text, mother_tongue text, social_category text, minority text, religion text, bpl boolean, aay boolean, disadvantaged boolean,
               cwsn boolean, cwsn_note text, disability_type text, udid_no text, rte_admission boolean, apaar_id text, pen text, aadhaar_last4 text, blood_group text,
               height_cm numeric, weight_kg numeric, medium text, stream text, prev_result text, prev_percent numeric, prev_attendance_days int, facilities text[],
               previous_school text, nationality text, missing text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can export UDISE+ data'; end if;
  return query
  with py as (select y0.id, y0.start_date, y0.end_date from public.academic_year y0
              where y0.school_id = v_school and y0.end_date < (select y1.start_date from public.academic_year y1 where y1.school_id = v_school and y1.is_current)
              order by y0.end_date desc limit 1),
  -- last year's days present, counted once for everyone
  pa as (select a.student_id, (count(*) filter (where a.status in ('present', 'late')))::int days
         from public.attendance_record a, py where a.school_id = v_school and a.period is null and a.on_date between py.start_date and py.end_date
         group by a.student_id),
  base as (
    select st.id, st.admission_no, st.full_name, st.gender, st.dob, c.name cname, c.level, sec.name sname, e.roll_no::int roll,
           p.admission_date, p.address_line, p.city, p.state, p.pincode, p.mother_tongue, p.blood_group, p.previous_school, p.nationality,
           p.height_cm, p.weight_kg, p.medium, p.stream, p.prev_result, p.prev_percent, p.prev_attendance_days, coalesce(p.facilities, '{}') facilities,
           i.category, i.religion, i.bpl, i.special_needs, i.special_needs_note, i.apaar_id, i.pen, i.aadhaar_last4,
           i.aadhaar_name, i.minority, i.aay, i.disadvantaged, i.disability_type, i.udid_no, i.rte_admission,
           coalesce(p.mother_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'mother%' limit 1)) mum,
           coalesce(p.father_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'father%' limit 1)) dad,
           (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id order by gs.is_primary desc limit 1) grd,
           coalesce(st.phone, (select g.phone from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.phone is not null order by gs.is_primary desc limit 1)) mob,
           coalesce(st.email, (select g.email from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.email is not null order by gs.is_primary desc limit 1)) mail,
           pe.status prev_status, pa.days prev_att_days
    from public.student_enrollment e
    join public.academic_year y on y.id = e.academic_year_id and y.is_current
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    left join public.student_profile p on p.student_id = st.id
    left join public.student_identity i on i.student_id = st.id
    left join public.student_enrollment pe on pe.student_id = st.id and pe.academic_year_id = (select id from py)
    left join pa on pa.student_id = st.id
    where e.school_id = v_school and e.status = 'active' and (p_section is null or e.section_id = p_section))
  select b.admission_no, b.full_name, b.aadhaar_name::text, b.gender::text, b.dob, b.cname, b.sname, b.roll, b.admission_date, b.mum, b.dad, b.grd, b.mob, b.mail,
         nullif(concat_ws(', ', b.address_line, b.city, b.state), ''), b.pincode::text, b.mother_tongue::text, b.category::text, b.minority::text, b.religion::text, b.bpl,
         coalesce(b.aay, false), coalesce(b.disadvantaged, false),
         b.special_needs, b.special_needs_note::text, b.disability_type::text, b.udid_no::text, coalesce(b.rte_admission, false),
         b.apaar_id::text, b.pen::text, b.aadhaar_last4::text, b.blood_group::text,
         b.height_cm, b.weight_kg, b.medium::text, b.stream::text, coalesce(b.prev_result, case b.prev_status when 'promoted' then 'promoted' when 'detained' then 'detained' when 'active' then 'promoted' end, case when b.admission_date >= (select y.start_date from public.academic_year y where y.school_id = v_school and y.is_current) then 'new' end)::text,
         b.prev_percent, coalesce(b.prev_attendance_days, b.prev_att_days), b.facilities,
         b.previous_school::text, coalesce(b.nationality::text, 'Indian'),
         array_remove(array[
           case when b.gender is null then 'Gender' end,
           case when b.dob is null then 'Date of birth' end,
           case when b.aadhaar_name is null then 'Name as on Aadhaar' end,
           case when b.mum is null then 'Mother''s name' end,
           case when b.dad is null then 'Father''s name' end,
           case when b.mob is null then 'Mobile number' end,
           case when b.address_line is null then 'Address' end,
           case when b.pincode is null or b.pincode !~ '^\d{6}$' then 'Pincode' end,
           case when b.mother_tongue is null then 'Mother tongue' end,
           case when b.category is null then 'Social category' end,
           case when b.minority is null then 'Minority group' end,
           case when b.religion is null then 'Religion' end,
           case when b.admission_date is null then 'Admission date' end,
           case when b.aadhaar_last4 is null then 'Aadhaar' end,
           case when b.apaar_id is null then 'APAAR ID' end,
           case when b.medium is null then 'Medium of instruction' end,
           case when b.height_cm is null or b.weight_kg is null then 'Height and weight' end,
           case when b.special_needs and b.disability_type is null then 'Type of disability' end,
           case when b.level >= 11 and b.stream is null then 'Stream' end
         ], null)
  from base b
  order by b.level, b.sname, b.roll nulls last, b.full_name, b.id;
end $$;
revoke all on function public.udise_student_rows(bigint) from public, anon;
grant execute on function public.udise_student_rows(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
