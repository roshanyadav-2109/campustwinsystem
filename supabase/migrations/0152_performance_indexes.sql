-- Performance: indexes for the queries large institutions run most.
--   lecture attendance (section + course + date, lecture rows only), per
--   student per course (shortage, holds), and institution-wide counts by date
--   (home pages, alerts) were falling back to full scans of the largest tables.
create index if not exists idx_att_lecture_section on public.attendance_record (section_id, subject_id, on_date) where period is not null;
create index if not exists idx_att_lecture_student on public.attendance_record (student_id, subject_id, on_date) where period is not null;
create index if not exists idx_att_school_date on public.attendance_record (school_id, on_date);
create index if not exists idx_absence_school_date on public.absence_notice (school_id, on_date);
create index if not exists idx_mark_school_student on public.mark (school_id, student_id);
create index if not exists idx_course_reg_student on public.course_registration (student_id, semester_id);
create index if not exists idx_relax_student on public.relaxation_request (student_id, semester_id);
create index if not exists idx_staff_position_staff_dates on public.staff_position (staff_id, starts_on, ends_on);
analyze public.attendance_record;
analyze public.mark;
analyze public.absence_notice;
analyze public.course_registration;
