-- After the product + CTO review of UDISE+, staff attendance, gate scan,
-- digital ID card and substitutions.
begin;

-- substitution helper: this institution only, not callable by users
create or replace function public.staff_away(p_staff bigint, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = p_staff and s.school_id = public.current_school_id())
     and (exists (select 1 from public.staff_attendance a where a.staff_id = p_staff and a.on_date = p_date and a.status in ('absent', 'leave'))
          or exists (select 1 from public.staff_leave l where l.staff_id = p_staff and l.status = 'approved' and p_date between l.from_date and l.to_date and coalesce(l.days, 1) >= 1));
$$;
revoke all on function public.staff_away(bigint, date) from public, anon, authenticated;

-- ---------- gate scan ----------
alter table public.attendance_record add column if not exists source text not null default 'teacher' check (source in ('teacher', 'gate'));
alter table public.school add column if not exists late_after time;   -- scans after this time mark "late" (empty: never)
create table if not exists public.gate_scan_log (
  id         bigint generated always as identity primary key,
  school_id  bigint not null references public.school(id) on delete cascade,
  student_id bigint references public.student(id) on delete cascade,
  scanned_by bigint references public.staff(id) on delete set null,
  result     text not null,
  at         timestamptz not null default now()
);
create index if not exists idx_gate_scan_log on public.gate_scan_log (school_id, at desc);
alter table public.gate_scan_log enable row level security;
drop policy if exists gsl_read on public.gate_scan_log;
create policy gsl_read on public.gate_scan_log for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
revoke all on public.gate_scan_log from anon, authenticated;
grant select on public.gate_scan_log to authenticated;
grant all on public.gate_scan_log to service_role;

drop function if exists public.scan_student_card(text);
create function public.scan_student_card(p_token text)
returns table (ok boolean, message text, student_name text, class_label text, status text, photo text)
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); k record; v_now timestamptz := now(); v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_rec record; v_new text; v_msg text; v_late time; v_holiday text;
begin
  if not (coalesce(app.is_admin_scope(), false) or coalesce(app.is_transport(), false)) then raise exception 'Only the office, principal or transport staff can scan cards'; end if;
  p_token := lower(trim(regexp_replace(coalesce(p_token, ''), '^.*/verify/', '')));
  if p_token !~ '^[a-f0-9]{32,64}$' then return query select false, 'This is not a CampusTwin card', null::text, null::text, null::text, null::text; return; end if;
  select c.id, c.status cstatus, c.school_id, st.id sid, st.full_name, st.status sstatus, st.photo_path, e.section_id, e.academic_year_id, cl.name || '-' || sec.name cls
    into k
    from public.id_card c join public.student st on st.id = c.student_id
    left join public.student_enrollment e on e.student_id = st.id and e.status = 'active'
      and e.academic_year_id = (select y.id from public.academic_year y where y.school_id = c.school_id and y.is_current limit 1)
    left join public.section sec on sec.id = e.section_id left join public.class cl on cl.id = sec.class_id
   where c.verify_token = p_token;
  if k.id is null then return query select false, 'Card not found', null::text, null::text, null::text, null::text; return; end if;
  if k.school_id <> v_school then return query select false, 'This card is from another institution', null::text, null::text, null::text, null::text; return; end if;
  if k.cstatus <> 'active' then v_msg := 'This card was cancelled (lost or replaced)';
  elsif k.sstatus <> 'active' or k.section_id is null then v_msg := 'This student is no longer enrolled';
  elsif extract(isodow from v_today) = 7 then v_msg := 'Today is Sunday: nothing is marked';
  elsif not coalesce(app.is_admin_scope(), false) and not exists (
        select 1 from public.student_transport t join public.bus_assignment a on a.route_id = t.route_id and a.is_active
        where t.student_id = k.sid and t.is_active and a.id in (select app.my_crew_assignments())) then
    v_msg := 'This student does not travel on your bus';
  end if;
  if v_msg is null then
    select e.title into v_holiday from public.event e where e.school_id = v_school and e.event_type = 'holiday' and v_today between e.start_date and coalesce(e.end_date, e.start_date) and e.class_id is null limit 1;
    if v_holiday is not null then v_msg := 'Today is a holiday (' || v_holiday || '): nothing is marked'; end if;
  end if;
  if v_msg is not null then
    insert into public.gate_scan_log (school_id, student_id, scanned_by, result) values (v_school, k.sid, app.my_staff_id(), v_msg);
    return query select false, v_msg, k.full_name, k.cls, null::text, k.photo_path; return;
  end if;

  select late_after into v_late from public.school where id = v_school;
  select a.id, a.status::text st into v_rec from public.attendance_record a where a.student_id = k.sid and a.on_date = v_today and a.period is null order by a.id limit 1;
  if v_rec.id is null then
    v_new := case when v_late is not null and (v_now at time zone 'Asia/Kolkata')::time > v_late then 'late' else 'present' end;
    insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, status, marked_by, school_id, source)
    values (k.sid, k.section_id, k.academic_year_id, v_today, v_new::public.attendance_status, app.my_staff_id(), v_school, 'gate');
    v_msg := 'Marked ' || v_new;
  elsif v_rec.st = 'absent' then
    update public.attendance_record set status = 'late', marked_by = app.my_staff_id() where id = v_rec.id;
    v_new := 'late'; v_msg := 'Was absent: now marked late';
  else
    v_new := v_rec.st; v_msg := 'Already marked ' || v_rec.st;
  end if;
  insert into public.gate_scan_log (school_id, student_id, scanned_by, result) values (v_school, k.sid, app.my_staff_id(), v_msg);
  return query select true, v_msg, k.full_name, k.cls, v_new, k.photo_path;
end $$;
revoke all on function public.scan_student_card(text) from public, anon;
grant execute on function public.scan_student_card(text) to authenticated;

-- a section counts as marked only when a teacher has marked it (gate scans are not a register)
create or replace function public.queue_attendance_missing() returns int
language sql security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  marked_schools as (
    select distinct ar.school_id from public.attendance_record ar, today where ar.on_date = today.d and ar.period is null and ar.source = 'teacher'),
  q as (
    insert into public.notification_outbox (school_id, event_key, ref_id, payload)
    select m.school_id, 'attendance_missing', extract(epoch from (select d from today))::bigint / 86400, jsonb_build_object('date', (select d from today))
    from marked_schools m
    where not exists (select 1 from public.notification_outbox o where o.event_key = 'attendance_missing' and o.school_id = m.school_id and o.payload ->> 'date' = (select d from today)::text)
    returning 1)
  select count(*)::int from q;
$$;
revoke all on function public.queue_attendance_missing() from public, anon, authenticated;

-- ---------- family details: each parent sees only their own phone and email ----------
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
      'guardians', (select coalesce(jsonb_agg(jsonb_build_object('name', g.full_name, 'relation', g.relation,
                                    'phone', case when g.id = app.my_guardian_id() then g.phone end,
                                    'email', case when g.id = app.my_guardian_id() then g.email end) order by gs.is_primary desc, g.full_name), '[]')
                      from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id))
  from public.student st join public.school s on s.id = st.school_id
  where st.id in (select app.my_owned_students()) and st.school_id = public.current_school_id()
  order by st.full_name;
$$;

-- ---------- UDISE+: mother's and father's names as proper fields ----------
alter table public.student_profile add column if not exists mother_name text check (mother_name is null or char_length(mother_name) <= 80);
alter table public.student_profile add column if not exists father_name text check (father_name is null or char_length(father_name) <= 80);
-- start them from the parents on record (only where the relation is clear)
update public.student_profile p set mother_name = coalesce(p.mother_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = p.student_id and lower(coalesce(g.relation, '')) like 'mother%' limit 1)),
                                    father_name = coalesce(p.father_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = p.student_id and lower(coalesce(g.relation, '')) like 'father%' limit 1));

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
           coalesce(p.mother_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'mother%' limit 1)) mum,
           coalesce(p.father_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'father%' limit 1)) dad,
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
           case when b.dad is null then 'Father''s name' end,
           case when b.mob is null then 'Mobile number' end,
           case when b.address_line is null then 'Address' end,
           case when b.pincode is null or b.pincode !~ '^\d{6}$' then 'Pincode' end,
           case when b.mother_tongue is null then 'Mother tongue' end,
           case when b.category is null then 'Social category' end,
           case when b.religion is null then 'Religion' end,
           case when b.admission_date is null then 'Admission date' end,
           case when b.aadhaar_last4 is null then 'Aadhaar' end,
           case when b.apaar_id is null then 'APAAR ID' end
         ], null)
  from base b
  order by b.level, b.sname, b.roll nulls last, b.full_name, b.id;
end $$;
commit;
