-- APAAR is a lifelong ID: the same student legitimately appears in the records
-- of every institution they study at (a school, then a college). Unique within
-- one institution only, not across CampusTwin.
drop index if exists public.uq_student_identity_apaar;
create unique index if not exists uq_student_identity_apaar on public.student_identity (school_id, apaar_id) where apaar_id is not null;
