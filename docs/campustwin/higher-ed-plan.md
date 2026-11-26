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

## Build order (each step: SQL self-test, live suite on Meridian / Lakeview / Westbridge North, boundary check)
1. **Academic structure (core, higher-ed).** `department`, `programme`, `regulation`, `semester`, `course`, `programme_course`; `class.programme_id` + `year_no`; `subject.course_id` bridge. Schools see nothing.
2. **Semester calendar.** Current semester switch; register, timetable and registration follow it.
3. **Course registration and electives.** Seat caps (the last seat goes to one student), credit min/max, office approval, core courses registered automatically.
4. **Faculty allotment and workload.** Electives spanning sections, workload report, clash check.
5. **Course attendance and 75% rule.** Marked from the timetable slot. Shortage, condonation and detention list feed the admit-card hold. Duty leave counts as present.
6. **Internal assessment.** CIA scheme per course type (reuse best-N and report locks).
7. **Semester exams.** Exam registration (regular + arrear), exam fee through the fee engine, seating; hall tickets list only registered courses.
8. **Grading engine.** Course and semester results, credit-weighted SGPA/CGPA, grace / moderation, separate CIA/ESE minimums; published results frozen.
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
