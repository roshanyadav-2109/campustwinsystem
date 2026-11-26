-- An admission enquiry remembers the student record it became, so "Admit"
-- creates the student exactly once and the enquiry can link to it.
begin;
alter table public.admission_enquiry
  add column if not exists student_id bigint references public.student(id) on delete set null;
create unique index if not exists admission_enquiry_student_once
  on public.admission_enquiry (student_id) where student_id is not null;
commit;
