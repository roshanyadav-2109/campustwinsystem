-- =============================================================================
-- Migration 0046 — Multi-institution tenancy
--
-- Turns the single-school ERP into a multi-institution one. Every table gains a
-- school_id, a RESTRICTIVE policy pins every authenticated read/write to the
-- caller's own institution, and global unique keys become unique per institution.
-- The 153 existing permissive policies are UNCHANGED: restrictive policies AND
-- with them, so all role/scope logic still applies, now inside one institution.
--
-- service_role bypasses RLS, so the company console/back end still sees every
-- institution. The 20 SECURITY DEFINER functions are hardened in 0047.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add school_id (nullable) to every table that lacks it.
-- ---------------------------------------------------------------------------
alter table public.profile add column if not exists school_id bigint references public.school(id);
alter table public.absence_notice add column if not exists school_id bigint references public.school(id);
alter table public.academic_year add column if not exists school_id bigint references public.school(id);
alter table public.admission_enquiry add column if not exists school_id bigint references public.school(id);
alter table public.admission_followup add column if not exists school_id bigint references public.school(id);
alter table public.announcement add column if not exists school_id bigint references public.school(id);
alter table public.assessment add column if not exists school_id bigint references public.school(id);
alter table public.assessment_type add column if not exists school_id bigint references public.school(id);
alter table public.attendance_record add column if not exists school_id bigint references public.school(id);
alter table public.bus_assignment add column if not exists school_id bigint references public.school(id);
alter table public.bus_live add column if not exists school_id bigint references public.school(id);
alter table public.class add column if not exists school_id bigint references public.school(id);
alter table public.class_subject add column if not exists school_id bigint references public.school(id);
alter table public.event add column if not exists school_id bigint references public.school(id);
alter table public.fee_head add column if not exists school_id bigint references public.school(id);
alter table public.fee_invoice add column if not exists school_id bigint references public.school(id);
alter table public.fee_invoice_line add column if not exists school_id bigint references public.school(id);
alter table public.fee_payment add column if not exists school_id bigint references public.school(id);
alter table public.fee_structure add column if not exists school_id bigint references public.school(id);
alter table public.feedback add column if not exists school_id bigint references public.school(id);
alter table public.guardian add column if not exists school_id bigint references public.school(id);
alter table public.guardian_student add column if not exists school_id bigint references public.school(id);
alter table public.homework add column if not exists school_id bigint references public.school(id);
alter table public.homework_submission add column if not exists school_id bigint references public.school(id);
alter table public.hpc_input add column if not exists school_id bigint references public.school(id);
alter table public.leave_application add column if not exists school_id bigint references public.school(id);
alter table public.library_book add column if not exists school_id bigint references public.school(id);
alter table public.library_issue add column if not exists school_id bigint references public.school(id);
alter table public.library_setting add column if not exists school_id bigint references public.school(id);
alter table public.mark add column if not exists school_id bigint references public.school(id);
alter table public.monthly_report add column if not exists school_id bigint references public.school(id);
alter table public.observation add column if not exists school_id bigint references public.school(id);
alter table public.payroll_run add column if not exists school_id bigint references public.school(id);
alter table public.payslip add column if not exists school_id bigint references public.school(id);
alter table public.profile add column if not exists school_id bigint references public.school(id);
alter table public.promotion add column if not exists school_id bigint references public.school(id);
alter table public.route_stop add column if not exists school_id bigint references public.school(id);
alter table public.section add column if not exists school_id bigint references public.school(id);
alter table public.slippage_flag add column if not exists school_id bigint references public.school(id);
alter table public.staff add column if not exists school_id bigint references public.school(id);
alter table public.staff_leave add column if not exists school_id bigint references public.school(id);
alter table public.staff_leave_type add column if not exists school_id bigint references public.school(id);
alter table public.staff_salary add column if not exists school_id bigint references public.school(id);
alter table public.student add column if not exists school_id bigint references public.school(id);
alter table public.student_enrollment add column if not exists school_id bigint references public.school(id);
alter table public.student_transport add column if not exists school_id bigint references public.school(id);
alter table public.subject add column if not exists school_id bigint references public.school(id);
alter table public.teacher_allotment add column if not exists school_id bigint references public.school(id);
alter table public.timetable_period add column if not exists school_id bigint references public.school(id);
alter table public.timetable_slot add column if not exists school_id bigint references public.school(id);
alter table public.transport_alert add column if not exists school_id bigint references public.school(id);
alter table public.trip add column if not exists school_id bigint references public.school(id);
alter table public.trip_ping add column if not exists school_id bigint references public.school(id);
alter table public.trip_stop_event add column if not exists school_id bigint references public.school(id);

-- ---------------------------------------------------------------------------
-- 2. Backfill every row to the one existing institution (id 1), with triggers
--    disabled so trigger-driven inserts (e.g. on_attendance_change) do not fire
--    before school_id defaults exist. One-time; this session only.
-- ---------------------------------------------------------------------------
set session_replication_role = replica;
update public.absence_notice set school_id = 1 where school_id is null;
update public.academic_year set school_id = 1 where school_id is null;
update public.admission_enquiry set school_id = 1 where school_id is null;
update public.admission_followup set school_id = 1 where school_id is null;
update public.announcement set school_id = 1 where school_id is null;
update public.assessment set school_id = 1 where school_id is null;
update public.assessment_type set school_id = 1 where school_id is null;
update public.attendance_record set school_id = 1 where school_id is null;
update public.bus set school_id = 1 where school_id is null;
update public.bus_assignment set school_id = 1 where school_id is null;
update public.bus_live set school_id = 1 where school_id is null;
update public.class set school_id = 1 where school_id is null;
update public.class_subject set school_id = 1 where school_id is null;
update public.event set school_id = 1 where school_id is null;
update public.fee_head set school_id = 1 where school_id is null;
update public.fee_invoice set school_id = 1 where school_id is null;
update public.fee_invoice_line set school_id = 1 where school_id is null;
update public.fee_payment set school_id = 1 where school_id is null;
update public.fee_structure set school_id = 1 where school_id is null;
update public.feedback set school_id = 1 where school_id is null;
update public.guardian set school_id = 1 where school_id is null;
update public.guardian_student set school_id = 1 where school_id is null;
update public.homework set school_id = 1 where school_id is null;
update public.homework_submission set school_id = 1 where school_id is null;
update public.hpc_input set school_id = 1 where school_id is null;
update public.leave_application set school_id = 1 where school_id is null;
update public.library_book set school_id = 1 where school_id is null;
update public.library_issue set school_id = 1 where school_id is null;
update public.library_setting set school_id = 1 where school_id is null;
update public.mark set school_id = 1 where school_id is null;
update public.monthly_report set school_id = 1 where school_id is null;
update public.observation set school_id = 1 where school_id is null;
update public.payroll_run set school_id = 1 where school_id is null;
update public.payslip set school_id = 1 where school_id is null;
update public.profile set school_id = 1 where school_id is null;
update public.promotion set school_id = 1 where school_id is null;
update public.route set school_id = 1 where school_id is null;
update public.route_stop set school_id = 1 where school_id is null;
update public.section set school_id = 1 where school_id is null;
update public.slippage_flag set school_id = 1 where school_id is null;
update public.staff set school_id = 1 where school_id is null;
update public.staff_leave set school_id = 1 where school_id is null;
update public.staff_leave_type set school_id = 1 where school_id is null;
update public.staff_salary set school_id = 1 where school_id is null;
update public.student set school_id = 1 where school_id is null;
update public.student_enrollment set school_id = 1 where school_id is null;
update public.student_transport set school_id = 1 where school_id is null;
update public.subject set school_id = 1 where school_id is null;
update public.teacher_allotment set school_id = 1 where school_id is null;
update public.timetable_period set school_id = 1 where school_id is null;
update public.timetable_slot set school_id = 1 where school_id is null;
update public.transport_alert set school_id = 1 where school_id is null;
update public.trip set school_id = 1 where school_id is null;
update public.trip_ping set school_id = 1 where school_id is null;
update public.trip_stop_event set school_id = 1 where school_id is null;
set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 3. profile.school_id NOT NULL + index, then current_school_id() (reads it).
--    SECURITY DEFINER so its own read of profile is not gated by profile's RLS.
-- ---------------------------------------------------------------------------
alter table public.profile alter column school_id set not null;
create index if not exists profile_school_id_idx on public.profile (school_id);

create or replace function public.current_school_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profile where id = auth.uid()
$$;
revoke all on function public.current_school_id() from public;
grant execute on function public.current_school_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Every other table: NOT NULL, default to the caller's institution so
--    existing INSERT code auto-stamps it, and an index for the policy check.
-- ---------------------------------------------------------------------------
alter table public.absence_notice alter column school_id set not null;
alter table public.absence_notice alter column school_id set default public.current_school_id();
create index if not exists absence_notice_school_id_idx on public.absence_notice (school_id);
alter table public.academic_year alter column school_id set not null;
alter table public.academic_year alter column school_id set default public.current_school_id();
create index if not exists academic_year_school_id_idx on public.academic_year (school_id);
alter table public.admission_enquiry alter column school_id set not null;
alter table public.admission_enquiry alter column school_id set default public.current_school_id();
create index if not exists admission_enquiry_school_id_idx on public.admission_enquiry (school_id);
alter table public.admission_followup alter column school_id set not null;
alter table public.admission_followup alter column school_id set default public.current_school_id();
create index if not exists admission_followup_school_id_idx on public.admission_followup (school_id);
alter table public.announcement alter column school_id set not null;
alter table public.announcement alter column school_id set default public.current_school_id();
create index if not exists announcement_school_id_idx on public.announcement (school_id);
alter table public.assessment alter column school_id set not null;
alter table public.assessment alter column school_id set default public.current_school_id();
create index if not exists assessment_school_id_idx on public.assessment (school_id);
alter table public.assessment_type alter column school_id set not null;
alter table public.assessment_type alter column school_id set default public.current_school_id();
create index if not exists assessment_type_school_id_idx on public.assessment_type (school_id);
alter table public.attendance_record alter column school_id set not null;
alter table public.attendance_record alter column school_id set default public.current_school_id();
create index if not exists attendance_record_school_id_idx on public.attendance_record (school_id);
alter table public.bus_assignment alter column school_id set not null;
alter table public.bus_assignment alter column school_id set default public.current_school_id();
create index if not exists bus_assignment_school_id_idx on public.bus_assignment (school_id);
alter table public.bus_live alter column school_id set not null;
alter table public.bus_live alter column school_id set default public.current_school_id();
create index if not exists bus_live_school_id_idx on public.bus_live (school_id);
alter table public.class alter column school_id set not null;
alter table public.class alter column school_id set default public.current_school_id();
create index if not exists class_school_id_idx on public.class (school_id);
alter table public.class_subject alter column school_id set not null;
alter table public.class_subject alter column school_id set default public.current_school_id();
create index if not exists class_subject_school_id_idx on public.class_subject (school_id);
alter table public.event alter column school_id set not null;
alter table public.event alter column school_id set default public.current_school_id();
create index if not exists event_school_id_idx on public.event (school_id);
alter table public.fee_head alter column school_id set not null;
alter table public.fee_head alter column school_id set default public.current_school_id();
create index if not exists fee_head_school_id_idx on public.fee_head (school_id);
alter table public.fee_invoice alter column school_id set not null;
alter table public.fee_invoice alter column school_id set default public.current_school_id();
create index if not exists fee_invoice_school_id_idx on public.fee_invoice (school_id);
alter table public.fee_invoice_line alter column school_id set not null;
alter table public.fee_invoice_line alter column school_id set default public.current_school_id();
create index if not exists fee_invoice_line_school_id_idx on public.fee_invoice_line (school_id);
alter table public.fee_payment alter column school_id set not null;
alter table public.fee_payment alter column school_id set default public.current_school_id();
create index if not exists fee_payment_school_id_idx on public.fee_payment (school_id);
alter table public.fee_structure alter column school_id set not null;
alter table public.fee_structure alter column school_id set default public.current_school_id();
create index if not exists fee_structure_school_id_idx on public.fee_structure (school_id);
alter table public.feedback alter column school_id set not null;
alter table public.feedback alter column school_id set default public.current_school_id();
create index if not exists feedback_school_id_idx on public.feedback (school_id);
alter table public.guardian alter column school_id set not null;
alter table public.guardian alter column school_id set default public.current_school_id();
create index if not exists guardian_school_id_idx on public.guardian (school_id);
alter table public.guardian_student alter column school_id set not null;
alter table public.guardian_student alter column school_id set default public.current_school_id();
create index if not exists guardian_student_school_id_idx on public.guardian_student (school_id);
alter table public.homework alter column school_id set not null;
alter table public.homework alter column school_id set default public.current_school_id();
create index if not exists homework_school_id_idx on public.homework (school_id);
alter table public.homework_submission alter column school_id set not null;
alter table public.homework_submission alter column school_id set default public.current_school_id();
create index if not exists homework_submission_school_id_idx on public.homework_submission (school_id);
alter table public.hpc_input alter column school_id set not null;
alter table public.hpc_input alter column school_id set default public.current_school_id();
create index if not exists hpc_input_school_id_idx on public.hpc_input (school_id);
alter table public.leave_application alter column school_id set not null;
alter table public.leave_application alter column school_id set default public.current_school_id();
create index if not exists leave_application_school_id_idx on public.leave_application (school_id);
alter table public.library_book alter column school_id set not null;
alter table public.library_book alter column school_id set default public.current_school_id();
create index if not exists library_book_school_id_idx on public.library_book (school_id);
alter table public.library_issue alter column school_id set not null;
alter table public.library_issue alter column school_id set default public.current_school_id();
create index if not exists library_issue_school_id_idx on public.library_issue (school_id);
alter table public.library_setting alter column school_id set not null;
alter table public.library_setting alter column school_id set default public.current_school_id();
create index if not exists library_setting_school_id_idx on public.library_setting (school_id);
alter table public.mark alter column school_id set not null;
alter table public.mark alter column school_id set default public.current_school_id();
create index if not exists mark_school_id_idx on public.mark (school_id);
alter table public.monthly_report alter column school_id set not null;
alter table public.monthly_report alter column school_id set default public.current_school_id();
create index if not exists monthly_report_school_id_idx on public.monthly_report (school_id);
alter table public.observation alter column school_id set not null;
alter table public.observation alter column school_id set default public.current_school_id();
create index if not exists observation_school_id_idx on public.observation (school_id);
alter table public.payroll_run alter column school_id set not null;
alter table public.payroll_run alter column school_id set default public.current_school_id();
create index if not exists payroll_run_school_id_idx on public.payroll_run (school_id);
alter table public.payslip alter column school_id set not null;
alter table public.payslip alter column school_id set default public.current_school_id();
create index if not exists payslip_school_id_idx on public.payslip (school_id);
alter table public.profile alter column school_id set not null;
create index if not exists profile_school_id_idx on public.profile (school_id);
alter table public.promotion alter column school_id set not null;
alter table public.promotion alter column school_id set default public.current_school_id();
create index if not exists promotion_school_id_idx on public.promotion (school_id);
alter table public.route_stop alter column school_id set not null;
alter table public.route_stop alter column school_id set default public.current_school_id();
create index if not exists route_stop_school_id_idx on public.route_stop (school_id);
alter table public.section alter column school_id set not null;
alter table public.section alter column school_id set default public.current_school_id();
create index if not exists section_school_id_idx on public.section (school_id);
alter table public.slippage_flag alter column school_id set not null;
alter table public.slippage_flag alter column school_id set default public.current_school_id();
create index if not exists slippage_flag_school_id_idx on public.slippage_flag (school_id);
alter table public.staff alter column school_id set not null;
alter table public.staff alter column school_id set default public.current_school_id();
create index if not exists staff_school_id_idx on public.staff (school_id);
alter table public.staff_leave alter column school_id set not null;
alter table public.staff_leave alter column school_id set default public.current_school_id();
create index if not exists staff_leave_school_id_idx on public.staff_leave (school_id);
alter table public.staff_leave_type alter column school_id set not null;
alter table public.staff_leave_type alter column school_id set default public.current_school_id();
create index if not exists staff_leave_type_school_id_idx on public.staff_leave_type (school_id);
alter table public.staff_salary alter column school_id set not null;
alter table public.staff_salary alter column school_id set default public.current_school_id();
create index if not exists staff_salary_school_id_idx on public.staff_salary (school_id);
alter table public.student alter column school_id set not null;
alter table public.student alter column school_id set default public.current_school_id();
create index if not exists student_school_id_idx on public.student (school_id);
alter table public.student_enrollment alter column school_id set not null;
alter table public.student_enrollment alter column school_id set default public.current_school_id();
create index if not exists student_enrollment_school_id_idx on public.student_enrollment (school_id);
alter table public.student_transport alter column school_id set not null;
alter table public.student_transport alter column school_id set default public.current_school_id();
create index if not exists student_transport_school_id_idx on public.student_transport (school_id);
alter table public.subject alter column school_id set not null;
alter table public.subject alter column school_id set default public.current_school_id();
create index if not exists subject_school_id_idx on public.subject (school_id);
alter table public.teacher_allotment alter column school_id set not null;
alter table public.teacher_allotment alter column school_id set default public.current_school_id();
create index if not exists teacher_allotment_school_id_idx on public.teacher_allotment (school_id);
alter table public.timetable_period alter column school_id set not null;
alter table public.timetable_period alter column school_id set default public.current_school_id();
create index if not exists timetable_period_school_id_idx on public.timetable_period (school_id);
alter table public.timetable_slot alter column school_id set not null;
alter table public.timetable_slot alter column school_id set default public.current_school_id();
create index if not exists timetable_slot_school_id_idx on public.timetable_slot (school_id);
alter table public.transport_alert alter column school_id set not null;
alter table public.transport_alert alter column school_id set default public.current_school_id();
create index if not exists transport_alert_school_id_idx on public.transport_alert (school_id);
alter table public.trip alter column school_id set not null;
alter table public.trip alter column school_id set default public.current_school_id();
create index if not exists trip_school_id_idx on public.trip (school_id);
alter table public.trip_ping alter column school_id set not null;
alter table public.trip_ping alter column school_id set default public.current_school_id();
create index if not exists trip_ping_school_id_idx on public.trip_ping (school_id);
alter table public.trip_stop_event alter column school_id set not null;
alter table public.trip_stop_event alter column school_id set default public.current_school_id();
create index if not exists trip_stop_event_school_id_idx on public.trip_stop_event (school_id);
alter table public.bus alter column school_id set default public.current_school_id();
create index if not exists bus_school_id_idx on public.bus (school_id);
alter table public.route alter column school_id set default public.current_school_id();
create index if not exists route_school_id_idx on public.route (school_id);

-- ---------------------------------------------------------------------------
-- 5. Rescope global unique keys to be unique PER institution.
-- ---------------------------------------------------------------------------
alter table public.timetable_slot drop constraint if exists timetable_slot_period_no_fkey;
alter table public.academic_year drop constraint if exists academic_year_name_key;
alter table public.academic_year drop constraint if exists academic_year_name_school_key;
alter table public.academic_year add constraint academic_year_name_school_key unique (school_id, name);
alter table public.assessment_type drop constraint if exists assessment_type_code_key;
alter table public.assessment_type drop constraint if exists assessment_type_code_school_key;
alter table public.assessment_type add constraint assessment_type_code_school_key unique (school_id, code);
alter table public.class drop constraint if exists class_name_key;
alter table public.class drop constraint if exists class_name_school_key;
alter table public.class add constraint class_name_school_key unique (school_id, name);
alter table public.class drop constraint if exists class_level_key;
alter table public.class drop constraint if exists class_level_school_key;
alter table public.class add constraint class_level_school_key unique (school_id, level);
alter table public.fee_payment drop constraint if exists fee_payment_receipt_no_key;
alter table public.fee_payment drop constraint if exists fee_payment_receipt_no_school_key;
alter table public.fee_payment add constraint fee_payment_receipt_no_school_key unique (school_id, receipt_no);
alter table public.library_book drop constraint if exists library_book_accession_no_key;
alter table public.library_book drop constraint if exists library_book_accession_no_school_key;
alter table public.library_book add constraint library_book_accession_no_school_key unique (school_id, accession_no);
alter table public.payroll_run drop constraint if exists payroll_run_month_key;
alter table public.payroll_run drop constraint if exists payroll_run_month_school_key;
alter table public.payroll_run add constraint payroll_run_month_school_key unique (school_id, month);
alter table public.staff drop constraint if exists staff_employee_code_key;
alter table public.staff drop constraint if exists staff_employee_code_school_key;
alter table public.staff add constraint staff_employee_code_school_key unique (school_id, employee_code);
alter table public.staff_leave_type drop constraint if exists staff_leave_type_code_key;
alter table public.staff_leave_type drop constraint if exists staff_leave_type_code_school_key;
alter table public.staff_leave_type add constraint staff_leave_type_code_school_key unique (school_id, code);
alter table public.student drop constraint if exists student_admission_no_key;
alter table public.student drop constraint if exists student_admission_no_school_key;
alter table public.student add constraint student_admission_no_school_key unique (school_id, admission_no);
alter table public.subject drop constraint if exists subject_code_key;
alter table public.subject drop constraint if exists subject_code_school_key;
alter table public.subject add constraint subject_code_school_key unique (school_id, code);
alter table public.timetable_period drop constraint if exists timetable_period_period_no_key;
alter table public.timetable_period drop constraint if exists timetable_period_period_no_school_key;
alter table public.timetable_period add constraint timetable_period_period_no_school_key unique (school_id, period_no);
-- Re-add the timetable FK as composite, matching the new per-school unique.
alter table public.timetable_slot drop constraint if exists timetable_slot_school_period_fkey;
alter table public.timetable_slot add constraint timetable_slot_school_period_fkey
  foreign key (school_id, period_no) references public.timetable_period (school_id, period_no)
  on update cascade on delete cascade;

-- Partial unique indexes that were global:
drop index if exists public.one_current_year;
create unique index one_current_year on public.academic_year (school_id) where is_current;
drop index if exists public.uq_fee_head_name;
create unique index uq_fee_head_name on public.fee_head (school_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation: one RESTRICTIVE policy per table. ANDs with every
--    existing permissive policy, so no authenticated user can read or write a
--    row outside their own institution, whatever the permissive policies allow.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.absence_notice;
create policy tenant_isolation on public.absence_notice as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.academic_year;
create policy tenant_isolation on public.academic_year as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.admission_enquiry;
create policy tenant_isolation on public.admission_enquiry as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.admission_followup;
create policy tenant_isolation on public.admission_followup as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.announcement;
create policy tenant_isolation on public.announcement as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.assessment;
create policy tenant_isolation on public.assessment as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.assessment_type;
create policy tenant_isolation on public.assessment_type as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.attendance_record;
create policy tenant_isolation on public.attendance_record as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.bus;
create policy tenant_isolation on public.bus as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.bus_assignment;
create policy tenant_isolation on public.bus_assignment as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.bus_live;
create policy tenant_isolation on public.bus_live as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.class;
create policy tenant_isolation on public.class as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.class_subject;
create policy tenant_isolation on public.class_subject as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.event;
create policy tenant_isolation on public.event as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.fee_head;
create policy tenant_isolation on public.fee_head as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.fee_invoice;
create policy tenant_isolation on public.fee_invoice as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.fee_invoice_line;
create policy tenant_isolation on public.fee_invoice_line as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.fee_payment;
create policy tenant_isolation on public.fee_payment as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.fee_structure;
create policy tenant_isolation on public.fee_structure as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.feedback;
create policy tenant_isolation on public.feedback as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.guardian;
create policy tenant_isolation on public.guardian as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.guardian_student;
create policy tenant_isolation on public.guardian_student as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.homework;
create policy tenant_isolation on public.homework as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.homework_submission;
create policy tenant_isolation on public.homework_submission as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.hpc_input;
create policy tenant_isolation on public.hpc_input as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.leave_application;
create policy tenant_isolation on public.leave_application as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.library_book;
create policy tenant_isolation on public.library_book as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.library_issue;
create policy tenant_isolation on public.library_issue as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.library_setting;
create policy tenant_isolation on public.library_setting as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.mark;
create policy tenant_isolation on public.mark as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.monthly_report;
create policy tenant_isolation on public.monthly_report as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.observation;
create policy tenant_isolation on public.observation as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.payroll_run;
create policy tenant_isolation on public.payroll_run as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.payslip;
create policy tenant_isolation on public.payslip as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.profile;
create policy tenant_isolation on public.profile as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.promotion;
create policy tenant_isolation on public.promotion as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.route;
create policy tenant_isolation on public.route as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.route_stop;
create policy tenant_isolation on public.route_stop as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.school;
create policy tenant_isolation on public.school as restrictive for all to authenticated
  using (id = public.current_school_id()) with check (id = public.current_school_id());
drop policy if exists tenant_isolation on public.section;
create policy tenant_isolation on public.section as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.slippage_flag;
create policy tenant_isolation on public.slippage_flag as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.staff;
create policy tenant_isolation on public.staff as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.staff_leave;
create policy tenant_isolation on public.staff_leave as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.staff_leave_type;
create policy tenant_isolation on public.staff_leave_type as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.staff_salary;
create policy tenant_isolation on public.staff_salary as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.student;
create policy tenant_isolation on public.student as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.student_enrollment;
create policy tenant_isolation on public.student_enrollment as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.student_transport;
create policy tenant_isolation on public.student_transport as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.subject;
create policy tenant_isolation on public.subject as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.teacher_allotment;
create policy tenant_isolation on public.teacher_allotment as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.timetable_period;
create policy tenant_isolation on public.timetable_period as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.timetable_slot;
create policy tenant_isolation on public.timetable_slot as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.transport_alert;
create policy tenant_isolation on public.transport_alert as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.trip;
create policy tenant_isolation on public.trip as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.trip_ping;
create policy tenant_isolation on public.trip_ping as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists tenant_isolation on public.trip_stop_event;
create policy tenant_isolation on public.trip_stop_event as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
