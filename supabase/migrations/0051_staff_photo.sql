-- 0051: staff photo. student.photo_path already exists; add the matching column
-- on staff. Stores the public R2 URL (cdn.campustwin.org/...). Idempotent.
alter table public.staff add column if not exists photo_path text;
select 'staff.photo_path added' as status;
