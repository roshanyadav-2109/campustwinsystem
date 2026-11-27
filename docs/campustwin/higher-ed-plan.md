# College and university editions: build plan (27 Nov 2026, Fable product + CTO)

Today `src/editions/college` and `src/editions/university` hold words only. Programmes are faked as `class` rows ("B.Tech CSE Year 1"). An edition folder cannot import another, so anything both need sits in `src/core` with `editions: ["college", "university"]`; edition folders stay thin.

## What differs from school
- **College structure.** Department, then programme (regulation, duration, credits), then semester, then course (code, L-T-P, credits, type: core / elective / AEC / SEC / VAC / lab). `class`/`section` stay as year batch / division, because fees, seats, timetable and attendance key on them.
- **Semesters.** Semesters sit inside the academic year (odd/even, dates, registration window).
- **Course registration.** Per student per semester: elective baskets, seat caps, credit limits.
- **Assessment.** Internal (CIA) plus external (ESE), with separate pass minimums. Grade points give SGPA and CGPA. Backlogs and supplementary or improvement attempts are tracked.
- **Attendance.** Per course and period: 75% rule, condonation band, detention list.
- **Users.** The student is the main user, not the parent. Faculty workload is tracked against norms.
- **University additions:**
  - one catalogue across campuses (campuses are separate tenants);
  - a central exam cell (common sessions, hall tickets, coded valuation, moderation, revaluation);
  - results published across campuses;
  - degree, transcript and consolidated grade card (ABC / APAAR credits);
  - inter-campus transfer with credits;
  - constituent vs affiliated colleges.

## Roles and positions (colleges and universities)

Owner (27 Nov): role names should match how colleges and universities actually work. Each institution creates its own titles (Vice Chancellor, Dean, Director, HoD and so on) and picks a type for each, and access follows the type. One person can hold several positions (Dean and Director together, for example). Schools stay as they are.

### Three parts
1. **Position title (each institution names its own).** The institution creates, renames or retires titles, for example:
   - *University:* Chancellor, Pro-Chancellor, Vice Chancellor, Pro Vice Chancellor, Registrar, Controller of Examinations, Finance Officer, Dean (Academics), Dean of Students, Dean of a faculty, Director (campus, institute, centre or department), Head of Department, Programme Coordinator, Professor, Associate Professor, Assistant Professor, Class Advisor or Mentor, Warden, Librarian, Admissions Officer, Office Assistant, Accountant.
   - *College:* Principal, Vice Principal, Director, Dean, Controller of Examinations, Head of Department, faculty titles, Office Superintendent, Accountant.
   - Sample titles are seeded per edition, and every one can be renamed. Titles appear wherever a person's role is shown: staff list, approvals ("approved by Dr X, Dean"), notices, and PDF signature lines (grade cards, hall tickets, certificates) instead of the fixed "Principal".
2. **Access type (a fixed CampusTwin list).** Access follows the type, never the free-text title, so "Director" can be a campus head at one university and a department head at another.

   | Type | Gives | Usual titles |
   |---|---|---|
   | Governing (view only) | Reports and dashboards, no changes | Chancellor, Pro-Chancellor, trustees |
   | Head of institution | Everything a principal has, approvals at the top | Vice Chancellor, Principal, campus Director |
   | Deputy head | Same as head, except settings and staff access | Pro VC, Vice Principal |
   | Registrar / administration | Everything the office has: students, staff, fees, settings | Registrar, Office Superintendent |
   | Examinations head | Exam timetable, hall tickets, evaluation, results, revaluation, transcripts | Controller of Examinations |
   | Finance head | Fees, payments, accounts, refunds, reports | Finance Officer, Accounts head |
   | Dean | Academic view and approvals over the departments in their faculty | Dean of Engineering, Dean (Academics) |
   | Department head | Courses, registrations, workload, attendance condonation, marks and results preview for their department | HoD, departmental Director |
   | Programme coordinator | The same as department head, for one programme | Programme Coordinator |
   | Faculty | Their own courses: lectures, attendance, marks | Professor, Assistant Professor, Lecturer |
   | Advisor / mentor | Their section or mentees: attendance, results, leave | Class Advisor, Mentor |
   | Office staff | Front office, admissions, certificates (no settings) | Office Assistant, Admissions Officer |
   | Service roles | One area only | Warden (hostel), Librarian, Transport in-charge |
   | Student-affairs head | Discipline, notices to students, clubs, hostel overview | Dean of Students |

3. **Scope (where the position applies).** Each scope level is a unit of the organisation:
   - **university:** every campus (Westbridge);
   - **campus:** one college or campus;
   - **faculty or school:** a group of departments, such as the School of Engineering (a new level between campus and department);
   - **department;**
   - **programme.**

   The type sets what a person may do, and the scope sets where. A Dean of Engineering is the *Dean* type scoped to the School of Engineering. A departmental Director is the *Department head* type scoped to that department.

### Many positions per person
- A person holds any number of positions, each with a start date and an optional end date. A position can also be marked "in charge" (acting) while the post is vacant.
- Access is the union of all current positions. The person's home and menu show everything they can do. Each approval records which position it was given in ("as Dean", "as HoD").
- A position that has ended stops giving access on its end date, with no manual clean-up.

### How access is enforced
- **In the database, never only on screen.** New helpers:
  - `app.has_access(type)`, true if any current position has the type;
  - `app.heads_department(dept)`, true for the department's head, the Dean of its faculty, or a campus or university head;
  - `app.in_my_scope(campus, dept, programme)`.
  - Tables and functions move to these one area at a time: courses and registration first, then attendance condonation, then results.
- **A department head is never given campus-wide rights.** The existing `is_admin_scope()` / `is_office()` (principal / office) stay as they are for schools and for campus-wide types only.
- **The existing staff role stays.**
  - Every staff row keeps its role (subject_teacher, class_teacher, principal, office, transport) as the base, so nothing that works today breaks.
  - Positions add to it. A position with a campus-wide head type counts as principal, and one with the registrar type counts as office.
  - No new values are added to the `staff_role` list.
- **No self-promotion.**
  - Only the head of institution or the registrar creates titles and assigns positions.
  - Nobody can assign a type above their own, or a scope wider than their own.
  - Every assignment and removal is logged.
- **University-level positions** (VC, Registrar, CoE for all campuses) belong to the central university login, which already works across campuses. Its scope is "university", so the cross-campus overview and a future central exam cell follow it.

### Screens
- **Settings → Roles and positions** (head and registrar):
  - titles with their type and default scope;
  - add or rename titles;
  - see who holds each one.
- **Settings → Organisation:** faculties or schools, and their departments.
- **Staff record → Positions:** add a position (title, scope, from, to, acting), end a position, history.
- **Menu and home:** built from the person's types, so a Dean sees department dashboards and pending approvals; an HoD sees their department's courses, registrations and shortage list.

### Build order (before step 9, since later steps depend on who approves what)
1. **Titles and positions, no access change.** Tables `position_title` (name, type, default scope level) and `staff_position` (staff, title, scope unit, from, to, acting), plus `academic_unit` (faculty or school). Seeded titles per edition, the settings screens, and titles shown in the staff list and on PDFs.
2. **Campus-wide types:** head, deputy, registrar, exams head, finance head, mapped onto the existing principal and office checks plus area checks (results publish = exams head or registrar).
3. **Scoped types:** Dean, department head, programme coordinator and advisor, with the new helpers in courses, registration, condonation and the results preview.
4. **University-level positions** across campuses (Westbridge).
5. **Approval chains** that can be set up (for example: condonation HoD → Dean; leave HoD → Dean → Registrar). They use the titles, so each institution's chain reads in its own words.

Tests: an SQL self-test per slice (scope limits, no self-promotion, ended positions lose access). Live suites on Meridian (college), Westbridge North and the Westbridge central login (university). The school suites must still pass untouched.

### Examination department (its own roles and its own dashboard)

Owner (27 Nov): the examination department has its own roles and a separate dashboard.

**The department is a unit.** "Examination department" (exam cell, or Office of the Controller of Examinations) is a unit like a department. At a university it can sit at university level (central exam cell for all campuses) or per campus. At an affiliated college it is the college exam cell that works with the university.

**Exam access types** (the fixed list; titles stay institution-named):

| Type | Gives | Usual titles |
|---|---|---|
| Examinations head | Everything below; publishes results; signs grade cards and transcripts | Controller of Examinations (CoE) |
| Exam deputy | Everything except publishing and settings | Additional or Deputy CoE, Assistant Registrar (Exams) |
| Exam section staff | Exam registrations, exam fees, timetable, hall tickets, seating, marks import, data entry | Superintendent, Section Officer, Exam Assistant |
| Confidential section | Question paper setters and moderators, paper status, dummy (coded) numbers, the decoding key; nobody else sees these | Confidential Officer |
| Evaluator | Enters marks only for the answer scripts given to them, by dummy number, with no student names | Examiner, Valuer |
| Moderator / scrutiniser | Checks and adjusts marks for a course within set limits, logged | Chief Examiner, Moderator, Scrutiniser |
| Exam-centre staff | On exam days, for their centre or room: attendance, absentees, malpractice reports | Chief Superintendent, Invigilator, Flying squad |
| Revaluation committee | Revaluation and re-totalling requests and outcomes | Revaluation Officer |

Faculty keep their internal (CIA) marks. From the moment ESE marks are entered, results belong to the exam department. A Dean or HoD sees results previews for their scope but cannot publish.

**Exam department dashboard** (its own home, not the principal's or the office's):
1. **This exam session at a glance:**
   - a calendar of sessions (regular, supplementary, improvement);
   - for the open session, a stage bar: registration → fees → hall tickets → exams → evaluation → moderation → results → revaluation.
2. **Readiness before exams:**
   - exam registrations received and missing (regular and backlog);
   - exam fees paid and due;
   - hall tickets issued and withheld, with reasons (attendance shortage, fees);
   - timetable clashes (a student with two papers at once);
   - seating plan and room capacity;
   - invigilation duties assigned and free;
   - question papers set, moderated, printed, by course (confidential section only).
3. **Exam days:**
   - today's papers, rooms and invigilators;
   - attendance per room as it is marked, absentees;
   - malpractice reports raised, with the student's paper held.
4. **Evaluation:**
   - answer scripts by course;
   - marks entered against marks pending, per evaluator (by dummy number);
   - courses ready for moderation.
5. **Results:**
   - per programme and section: incomplete, ready, published, held back;
   - pass percentage and grade spread by course, unusual courses flagged (all fail or all pass) before publishing;
   - publish and revise (with reason), as already built.
6. **After results:**
   - revaluation and re-totalling requests, with fee and status;
   - supplementary registrations;
   - transcript, provisional certificate and duplicate grade-card requests;
   - verification requests from employers (QR checks so far).
7. **Alerts:** marks overdue from evaluators, papers not moderated, results held back, requests close to their deadline.

Everyone in the exam department sees only the parts their type allows. An invigilator's home is just today's duty. An evaluator sees only the scripts allotted to them.

**Confidential by design:**
- Question papers and examiner names are visible to the CoE and the confidential section only.
- Evaluators work on dummy numbers, and the key to student identities is decoded only after evaluation.
- Every view of the key is logged.

**What is already built and moves under the exam department:**
- exam timetable and hall tickets (step 7);
- evaluation schemes;
- results preview, publish, revise and hold back (steps 6 and 8);
- grade-card QR check.

Publishing moves from "office" to the examinations head, or to the registrar where an institution has no CoE.

**Build order:**
- **Exam types and exam department unit:** part of roles slice 2.
- **Exam dashboard:** sections 1, 2 and 5 first, from data already built. Sections 3, 4, 6 and 7 are added with:
  - seating and invigilation;
  - dummy numbers and evaluator allotment;
  - moderation (with grace marks, step 8);
  - revaluation and supplementary (step 9);
  - transcripts (step 12).
- **University central exam cell:** with roles slice 4, at the "university" scope, working across all campuses.

Seed:
- Meridian gets a CoE, an exam section assistant, two evaluators and an invigilator.
- Westbridge gets a central CoE for all three campuses.

### To confirm with the owner
- Is the access-type list above complete? It is fixed by CampusTwin; institutions choose among the types and cannot invent new ones.
- Should the Chancellor and trustees have logins at all (view only), or appear only as titles?
- Should "Director" appear in the seeded titles at all three levels (campus, institute, department), so institutions just pick the one they use?

## Build order (each step: SQL self-test, live suite on Meridian / Lakeview / Westbridge North, boundary check)
1. **Academic structure (core, higher-ed).** `department`, `programme`, `regulation`, `semester`, `course`, `programme_course`; `class.programme_id` + `year_no`; `subject.course_id` bridge. Schools see nothing.
2. **Semester calendar.** Current semester switch; register, timetable and registration follow it.
3. **Course registration and electives.** Seat caps (the last seat goes to one student), credit min/max, office approval, core courses registered automatically.
4. **Faculty allotment and workload.** Electives spanning sections, workload report, clash check.
5. **Course attendance and 75% rule.** Marked from the timetable slot. Shortage, condonation and detention list feed the admit-card hold. Duty leave counts as present.
6. **Internal assessment.** CIA scheme per course type (reuse best-N and report locks).
7. **Semester exams.** Exam registration (regular + arrear), exam fee through the fee engine, seating; hall tickets list only registered courses.
8. **Grading engine.** Course and semester results, credit-weighted SGPA/CGPA, grace / moderation, separate CIA/ESE minimums; published results frozen.
8b. **Roles and positions** (see above): titles, types, scopes, several positions per person. Built before step 9.
9. **Backlogs and supplementary.** Attempt ledger, supplementary sessions, revaluation with fee; CGPA updates, old snapshots unchanged.
10. **Student-first experience.** Notices to the student, guardian optional.
11. **Affiliated-college pack** (`src/editions/college`). University details; internal marks export; result import from Excel; NAAC / AISHE counts.
12. **University pack** (`src/editions/university`).
    - Shared catalogue pushed to campuses.
    - Central exam cell; cross-campus publish through definer RPCs.
    - Transcript and degree with QR.
    - Inter-campus transfer keeping CGPA and one login.

Later: OBE / CO-PO, placements, PhD.

## Seed for testing (extend seed-sample.mjs; clean-sample.mjs removes all)
- 3-4 departments per college, one regulation per programme, semesters 1-6. Odd semester closed with results; even semester running.
- 6 courses per semester (4 core, 1 lab, 1 elective basket of 3), 20-22 credits.
- Registrations for all students, with one elective full.
- 8 weeks of period-wise attendance; about 10% of students at 60-75%, 2 condoned.
- 3 CIAs + ESE in the closed semester; about 8% failures; one supplementary session; 2 revaluations.
- One overloaded and one under-loaded faculty member.
- Westbridge:
  - a shared catalogue;
  - BBA at North and City (for transfers);
  - one central exam session;
  - a controller-of-examinations login;
  - one completed transfer;
  - one graduated MBA batch for transcripts.
