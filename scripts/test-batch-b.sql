-- Self-test for 0160 on Meridian (11): papers per course for supplementary
-- exams, the workload report, electives across sections. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); te uuid := gen_random_uuid(); v_off bigint; v_t bigint; v_sem record; v_type bigint; v_reg bigint; v_supp bigint; v_subj bigint;
  ok boolean; v_first bigint; v_sec1 bigint; v_other bigint; v_pc record; v_secs bigint[]; n int; v_roster int; d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-b-office@example.com', 'authenticated', 'authenticated'), (te, 'qa-b-t@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-b-office@example.com', 'office') returning id into v_off;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Elective Teacher', 'qa-b-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off), (te, 'staff', 'QA Teacher', 11, v_t);
  select * into v_sem from public.semester where school_id = 11 and is_current;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  select id into v_subj from public.subject where school_id = 11 and course_id is not null limit 1;

  -- 1. a paper without a class: only in a supplementary exam
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id) values (v_sem.academic_year_id, 'QA Regular B', 1, v_type) returning id into v_reg;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, kind, for_semester_id) values (v_sem.academic_year_id, 'QA Supp B', 1, v_type, 'supplementary', v_sem.id) returning id into v_supp;
  ok := false; begin insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks) values (v_reg, null, v_subj, d + 5, '09:00', '12:00', 100); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL a regular paper without a class'; end if;
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks) values (v_supp, null, v_subj, d + 5, '09:00', '12:00', 100);
  if exists (select 1 from public.assessment a join public.exam_paper p on p.id = a.exam_paper_id where p.session_id = v_supp) then raise exception 'FAIL marks columns made for a course paper'; end if;
  -- 2. workload
  if not exists (select 1 from public.faculty_workload(v_sem.id) where planned_hours > 0) then raise exception 'FAIL workload empty'; end if;
  reset role;

  -- 3. an elective taught to two sections of one class: one roster, one lecture
  select c.id class_id, c.programme_id, c.year_no into v_pc from public.class c
   where c.school_id = 11 and c.programme_id is not null and (select count(*) from public.section sec where sec.class_id = c.id) >= 2 limit 1;
  insert into public.course (school_id, code, name, kind, lecture, tutorial, practical, credits) values (11, 'QAEL1', 'QA Elective', 'elective', 3, 0, 0, 3) returning id into v_supp;
  insert into public.subject (school_id, name, code, course_id) values (11, 'QA Elective', 'QAEL1', v_supp) returning id into v_subj;
  insert into public.programme_course (school_id, programme_id, course_id, semester_no, elective_group)
  values (11, v_pc.programme_id, v_supp, 2 * v_pc.year_no - case when v_sem.kind = 'odd' then 1 else 0 end, 'QA-E');
  insert into public.course_registration (school_id, semester_id, student_id, programme_course_id, status)
  select 11, v_sem.id, x.student_id, (select pc2.id from public.programme_course pc2 where pc2.course_id = v_supp), 'approved'
  from (select distinct on (e.section_id) e.student_id from public.student_enrollment e join public.section sec on sec.id = e.section_id
        where sec.class_id = v_pc.class_id and e.status = 'active' and e.academic_year_id = v_sem.academic_year_id order by e.section_id, e.student_id) x;
  v_pc := null;
  select v_supp course_id, v_subj subject_id into v_pc;
  select array_agg(distinct e.section_id) into v_secs from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
   join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id and e.status = 'active'
   where r.semester_id = v_sem.id and pc.course_id = v_pc.course_id and r.status <> 'dropped';
  insert into public.teacher_allotment (school_id, staff_id, section_id, subject_id, academic_year_id) select 11, v_t, unnest(v_secs), v_pc.subject_id, v_sem.academic_year_id;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into v_roster from public.course_roster(v_pc.subject_id);
  if v_roster = 0 then raise exception 'FAIL empty roster'; end if;
  if cardinality(v_secs) > 1 and (select count(distinct section_id) from public.course_roster(v_pc.subject_id)) < 2 then raise exception 'FAIL roster not across sections'; end if;
  n := public.mark_course_lecture(v_pc.subject_id, d, 7::smallint, '{}');
  if n <> v_roster then raise exception 'FAIL marked % of %', n, v_roster; end if;
  reset role;
  if exists (select 1 from public.attendance_record a join public.student_enrollment e on e.student_id = a.student_id and e.academic_year_id = v_sem.academic_year_id and e.status = 'active'
             where a.subject_id = v_pc.subject_id and a.on_date = d and a.period = 7 and a.section_id <> e.section_id) then raise exception 'FAIL record in the wrong section'; end if;
  -- re-marking is logged; a clash with another course in the same period names the student
  select r.student_id, r.section_id into v_first, v_sec1 from public.course_roster(v_pc.subject_id) r limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.mark_course_lecture(v_pc.subject_id, d, 7::smallint, array[v_first]);
  reset role;
  if not exists (select 1 from public.attendance_change_log where subject_id = v_pc.subject_id and on_date = d and period = 7 and section_id = v_sec1) then raise exception 'FAIL elective re-mark not logged'; end if;
  select id into v_other from public.subject where school_id = 11 and id <> v_pc.subject_id limit 1;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, school_id) values (v_first, v_sec1, v_sem.academic_year_id, d, 6, v_other, 'present', 11);
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.mark_course_lecture(v_pc.subject_id, d, 6::smallint, '{}'); exception when others then ok := sqlerrm like '%already marked for another course%'; end;
  if not ok then raise exception 'FAIL period clash not named'; end if;
  -- marking the elective from a section page: only students registered in it
  n := public.mark_lecture(v_sec1, v_pc.subject_id, d, 5::smallint, '{}');
  select count(*) into v_roster from public.course_roster(v_pc.subject_id) r where r.section_id = v_sec1;
  reset role;
  if v_roster = 0 or n <> v_roster then raise exception 'FAIL section marking: % marked, % registered in the section', n, v_roster; end if;
end $$;
rollback;
