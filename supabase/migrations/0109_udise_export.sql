-- UDISE+ (SDMS) student data, for the office and principal: one row per
-- student of the current year in the order the portal asks, and the details
-- each student is still missing. Read page by page (no 1000-row limit).
-- Aadhaar is never stored in full here, so only its last four digits appear.
begin;
create or replace function public.udise_student_rows(p_section bigint default null)
returns table (admission_no text, student_name text, gender text, dob date, class_name text, section_name text, roll_no int,
               admission_date date, mother_name text, father_name text, guardian_name text, mobile text, email text,
               address text, pincode text, mother_tongue text, social_category text, religion text, bpl boolean,
               cwsn boolean, cwsn_note text, apaar_id text, pen text, aadhaar_last4 text, blood_group text, previous_school text,
               nationality text, missing text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can export UDISE+ data'; end if;
  return query
  with base as (
    select st.id, st.admission_no, st.full_name, st.gender, st.dob, c.name cname, c.level, sec.name sname, e.roll_no::int roll,
           p.admission_date, p.address_line, p.city, p.state, p.pincode, p.mother_tongue, p.blood_group, p.previous_school, p.nationality,
           i.category, i.religion, i.bpl, i.special_needs, i.special_needs_note, i.apaar_id, i.pen, i.aadhaar_last4,
           (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'mother%' limit 1) mum,
           (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'father%' limit 1) dad,
           (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id order by gs.is_primary desc limit 1) grd,
           coalesce(st.phone, (select g.phone from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.phone is not null order by gs.is_primary desc limit 1)) mob,
           coalesce(st.email, (select g.email from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.email is not null order by gs.is_primary desc limit 1)) mail
    from public.student_enrollment e
    join public.academic_year y on y.id = e.academic_year_id and y.is_current
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    left join public.student_profile p on p.student_id = st.id
    left join public.student_identity i on i.student_id = st.id
    where e.school_id = v_school and e.status = 'active' and (p_section is null or e.section_id = p_section))
  select b.admission_no, b.full_name, b.gender::text, b.dob, b.cname, b.sname, b.roll, b.admission_date, b.mum, b.dad, b.grd, b.mob, b.mail,
         nullif(concat_ws(', ', b.address_line, b.city, b.state), ''), b.pincode::text, b.mother_tongue::text, b.category::text, b.religion::text, b.bpl,
         b.special_needs, b.special_needs_note::text, b.apaar_id::text, b.pen::text, b.aadhaar_last4::text, b.blood_group::text, b.previous_school::text, coalesce(b.nationality::text, 'Indian'),
         array_remove(array[
           case when b.gender is null then 'Gender' end,
           case when b.dob is null then 'Date of birth' end,
           case when b.mum is null then 'Mother''s name' end,
           case when b.dad is null and b.grd is null then 'Father''s or guardian''s name' end,
           case when b.mob is null then 'Mobile number' end,
           case when b.address_line is null then 'Address' end,
           case when b.pincode is null or b.pincode !~ '^\d{6}$' then 'Pincode' end,
           case when b.mother_tongue is null then 'Mother tongue' end,
           case when b.category is null then 'Social category' end,
           case when b.religion is null then 'Religion' end,
           case when b.admission_date is null then 'Admission date' end
         ], null)
  from base b
  order by b.level, b.sname, b.roll nulls last, b.full_name;
end $$;
revoke all on function public.udise_student_rows(bigint) from public, anon;
grant execute on function public.udise_student_rows(bigint) to authenticated;
commit;
