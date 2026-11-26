-- Parents and students: the child's digital ID card (only once the office has
-- issued a card; a replaced card shows the new one) and the details the school
-- holds, read-only (Aadhaar only as its last four digits).
begin;
create or replace function public.my_family_cards()
returns table (student_id bigint, card jsonb)
language sql stable security definer set search_path = '' as $$
  select st.id,
    jsonb_build_object(
      'name', st.full_name, 'admission_no', st.admission_no, 'dob', st.dob, 'gender', st.gender, 'photo', st.photo_path, 'status', st.status,
      'class', (select c.name || '-' || sec.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
                 join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.student_id = st.id limit 1),
      'roll_no', (select e.roll_no from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.student_id = st.id limit 1),
      'school', jsonb_build_object('name', s.name, 'place', s.place, 'logo', s.logo_url, 'phone', s.phone),
      'id_card', (select jsonb_build_object('token', k.verify_token, 'year', y.name, 'issued', k.issued_at)
                    from public.id_card k join public.academic_year y on y.id = k.academic_year_id
                   where k.student_id = st.id and k.status = 'active' order by k.issued_at desc limit 1),
      'profile', (select jsonb_build_object('blood_group', p.blood_group, 'house', p.house, 'address', concat_ws(', ', p.address_line, p.city, p.state, p.pincode),
                                            'emergency_name', p.emergency_name, 'emergency_phone', p.emergency_phone, 'admission_date', p.admission_date, 'allergies', p.allergies)
                    from public.student_profile p where p.student_id = st.id),
      'identity', (select jsonb_build_object('apaar_id', i.apaar_id, 'pen', i.pen, 'aadhaar_last4', i.aadhaar_last4) from public.student_identity i where i.student_id = st.id),
      'guardians', (select coalesce(jsonb_agg(jsonb_build_object('name', g.full_name, 'relation', g.relation, 'phone', g.phone, 'email', g.email) order by gs.is_primary desc, g.full_name), '[]')
                      from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id))
  from public.student st join public.school s on s.id = st.school_id
  where st.id in (select app.my_owned_students()) and st.school_id = public.current_school_id()
  order by st.full_name;
$$;
grant execute on function public.my_family_cards() to authenticated;
commit;
