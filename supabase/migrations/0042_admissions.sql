-- =============================================================================
-- Migration 0042 — Admissions and enquiries
--
--  * admission_enquiry  : one row per child a family has asked about.
--  * admission_followup : the office's call / visit notes on an enquiry.
--
-- Who can do what (row security is the boundary, not the screen):
--  * principal and office can read everything here;
--  * only the office can add, change or remove enquiries and add follow-ups;
--  * students, guardians, teachers and signed-out visitors get nothing.
-- The public application form writes through the server with the service-role
-- key (which skips row security), never from the visitor's browser.
-- Only creates new objects. Safe to run more than once.
-- =============================================================================

create table if not exists public.admission_enquiry (
  id                bigint generated always as identity primary key,
  child_name        text not null check (char_length(child_name) between 1 and 80),
  date_of_birth     date,
  class_id          bigint not null references public.class(id) on delete restrict,
  guardian_name     text not null check (char_length(guardian_name) between 1 and 80),
  phone             text not null check (char_length(phone) between 8 and 16),
  email             text check (email is null or char_length(email) <= 120),
  address           text check (address is null or char_length(address) <= 300),
  previous_school   text check (previous_school is null or char_length(previous_school) <= 120),
  -- What the family wrote on the form, or the office's first note.
  message           text check (message is null or char_length(message) <= 500),
  source            text not null default 'walk_in'
                    check (source in ('walk_in', 'phone', 'online', 'referral', 'other')),
  status            text not null default 'new'
                    check (status in ('new', 'contacted', 'visit_scheduled', 'applied', 'admitted', 'not_interested')),
  assigned_to       bigint references public.staff(id) on delete set null,
  next_follow_up    date,
  -- The school year the child is applying for.
  academic_year_id  bigint not null default app.current_year_id()
                    references public.academic_year(id) on delete restrict,
  -- Null when the family applied online.
  created_by        bigint references public.staff(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists admission_enquiry_year_idx     on public.admission_enquiry (academic_year_id, created_at desc);
create index if not exists admission_enquiry_class_idx    on public.admission_enquiry (class_id);
create index if not exists admission_enquiry_status_idx   on public.admission_enquiry (status);
create index if not exists admission_enquiry_assigned_idx on public.admission_enquiry (assigned_to);
create index if not exists admission_enquiry_created_by_idx on public.admission_enquiry (created_by);
create index if not exists admission_enquiry_followup_idx on public.admission_enquiry (next_follow_up) where next_follow_up is not null;
-- The online form checks "same phone in the last 24 hours".
create index if not exists admission_enquiry_phone_idx    on public.admission_enquiry (phone, created_at desc);

drop trigger if exists trg_admission_enquiry_updated on public.admission_enquiry;
create trigger trg_admission_enquiry_updated before update on public.admission_enquiry
  for each row execute function public.set_updated_at();

create table if not exists public.admission_followup (
  id              bigint generated always as identity primary key,
  enquiry_id      bigint not null references public.admission_enquiry(id) on delete cascade,
  note            text not null check (char_length(note) between 1 and 1000),
  by_staff        bigint not null references public.staff(id) on delete restrict,
  next_follow_up  date,
  created_at      timestamptz not null default now()
);

create index if not exists admission_followup_enquiry_idx on public.admission_followup (enquiry_id, created_at desc);
create index if not exists admission_followup_staff_idx   on public.admission_followup (by_staff);

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table public.admission_enquiry  enable row level security;
alter table public.admission_followup enable row level security;

-- Signed-out visitors never touch these tables directly.
revoke all on public.admission_enquiry  from anon;
revoke all on public.admission_followup from anon;

drop policy if exists admission_enquiry_read on public.admission_enquiry;
create policy admission_enquiry_read on public.admission_enquiry
  for select to authenticated
  using ((select app.is_admin_scope()));

drop policy if exists admission_enquiry_insert on public.admission_enquiry;
create policy admission_enquiry_insert on public.admission_enquiry
  for insert to authenticated
  with check ((select app.is_office()));

drop policy if exists admission_enquiry_update on public.admission_enquiry;
create policy admission_enquiry_update on public.admission_enquiry
  for update to authenticated
  using ((select app.is_office()))
  with check ((select app.is_office()));

drop policy if exists admission_enquiry_delete on public.admission_enquiry;
create policy admission_enquiry_delete on public.admission_enquiry
  for delete to authenticated
  using ((select app.is_office()));

drop policy if exists admission_followup_read on public.admission_followup;
create policy admission_followup_read on public.admission_followup
  for select to authenticated
  using ((select app.is_admin_scope()));

-- A follow-up is always signed by the office member who wrote it.
drop policy if exists admission_followup_insert on public.admission_followup;
create policy admission_followup_insert on public.admission_followup
  for insert to authenticated
  with check ((select app.is_office()) and by_staff = (select app.my_staff_id()));
