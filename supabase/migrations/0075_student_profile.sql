-- Full student profile, split by who may see it.
--
-- student_profile: everyday details anyone who already sees the student may
--   read (their teachers, their family, the office and principal): admission
--   details, address, blood group, house, medical notes, emergency contact.
--   The office and principal edit it; a class teacher may update it for their
--   own class (as with the student row itself).
-- student_identity: identity and category details only the office and
--   principal see: APAAR ID, PEN (UDISE+), the last four digits of Aadhaar
--   (the full number is never stored), social category, religion, special
--   needs, BPL. Rows are per student, so a family or teacher can never read
--   these through the everyday profile.
-- Both are one row per student, created on first save. Idempotent.
begin;

create table if not exists public.student_profile (
  student_id        bigint primary key references public.student(id) on delete cascade,
  school_id         bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  admission_date    date,
  admitted_class    text check (admitted_class is null or char_length(admitted_class) <= 40),
  previous_school   text check (previous_school is null or char_length(previous_school) <= 160),
  mother_tongue     text check (mother_tongue is null or char_length(mother_tongue) <= 40),
  nationality       text check (nationality is null or char_length(nationality) <= 40),
  place_of_birth    text check (place_of_birth is null or char_length(place_of_birth) <= 80),
  blood_group       text check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  house             text check (house is null or char_length(house) <= 40),
  address_line      text check (address_line is null or char_length(address_line) <= 240),
  city              text check (city is null or char_length(city) <= 80),
  state             text check (state is null or char_length(state) <= 60),
  pincode           text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  allergies         text check (allergies is null or char_length(allergies) <= 300),
  medical_notes     text check (medical_notes is null or char_length(medical_notes) <= 500),
  emergency_name    text check (emergency_name is null or char_length(emergency_name) <= 80),
  emergency_phone   text check (emergency_phone is null or emergency_phone ~ '^[0-9+ -]{7,20}$'),
  updated_at        timestamptz not null default now()
);

create table if not exists public.student_identity (
  student_id        bigint primary key references public.student(id) on delete cascade,
  school_id         bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  apaar_id          text check (apaar_id is null or apaar_id ~ '^[0-9]{12}$'),
  pen               text check (pen is null or pen ~ '^[0-9]{11}$'),
  aadhaar_last4     text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  category          text check (category is null or category in ('general', 'sc', 'st', 'obc', 'ews')),
  religion          text check (religion is null or char_length(religion) <= 40),
  special_needs     boolean not null default false,
  special_needs_note text check (special_needs_note is null or char_length(special_needs_note) <= 200),
  bpl               boolean not null default false,
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_student_identity_apaar on public.student_identity (apaar_id) where apaar_id is not null;
create unique index if not exists uq_student_identity_pen on public.student_identity (school_id, pen) where pen is not null;

-- The school of a profile row always matches its student.
create or replace function public.student_detail_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select s.school_id into new.school_id from public.student s where s.id = new.student_id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_student_profile_school on public.student_profile;
create trigger trg_student_profile_school before insert or update on public.student_profile for each row execute function public.student_detail_school();
drop trigger if exists trg_student_identity_school on public.student_identity;
create trigger trg_student_identity_school before insert or update on public.student_identity for each row execute function public.student_detail_school();

alter table public.student_profile  enable row level security;
alter table public.student_identity enable row level security;

drop policy if exists tenant_isolation on public.student_profile;
create policy tenant_isolation on public.student_profile as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists student_profile_read on public.student_profile;
create policy student_profile_read on public.student_profile for select to authenticated
  using ((select app.is_admin_scope()) or student_id in (select app.my_scope_students()));
drop policy if exists student_profile_admin_write on public.student_profile;
create policy student_profile_admin_write on public.student_profile for all to authenticated
  using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
drop policy if exists student_profile_ct_insert on public.student_profile;
create policy student_profile_ct_insert on public.student_profile for insert to authenticated
  with check (student_id in (select app.my_ct_students()));
drop policy if exists student_profile_ct_update on public.student_profile;
create policy student_profile_ct_update on public.student_profile for update to authenticated
  using (student_id in (select app.my_ct_students())) with check (student_id in (select app.my_ct_students()));

drop policy if exists tenant_isolation on public.student_identity;
create policy tenant_isolation on public.student_identity as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists student_identity_admin on public.student_identity;
create policy student_identity_admin on public.student_identity for all to authenticated
  using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));

grant select, insert, update, delete on public.student_profile, public.student_identity to authenticated;
grant all on public.student_profile, public.student_identity to service_role;

drop trigger if exists trg_log_change on public.student_profile;
create trigger trg_log_change after insert or update or delete on public.student_profile for each row execute function public.log_change('Student profile');
drop trigger if exists trg_log_change on public.student_identity;
create trigger trg_log_change after insert or update or delete on public.student_identity for each row execute function public.log_change('Student identity');

commit;
