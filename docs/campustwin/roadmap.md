# CampusTwin: gap analysis and build plan

Written 26 Nov 2026. Order agreed with the owner: CampusTwin first, then Desk, HR, Finance, Alumni. Twin AI comes last.

Standard we build to:
- **Automatic by default.** Anything the system can work out, send, remind or file, it does. Staff type only what only a person can know.
- **Usable by someone who is not comfortable with computers.** One clear action per screen, plain words, guided first-time setup, phone first, Indian languages, nothing that needs a script or SQL.
- **Nothing missing that the best ERPs have.** Benchmarks: Fedena, MyClassboard, Edunext, Teachmint (Indian schools); CampX (Indian higher education); Workday Student, Ellucian Banner (global universities).

## 1. What CampusTwin has today (verified in code)

Admissions enquiries with follow-ups; public /apply form; attendance (whole-day, by class teacher); calendar (read-only); student self-details; parent feedback; fees (heads, class grid, bulk invoices, part payments, PDF receipts); homework (submit, mark); staff HR (leave, salary, payroll, payslips); student leave; library (catalogue, CSV import, issue/return, automatic fines); manage classes, exams, students (CSV import), teachers, logins; marks with release; progress analytics; promotion; report cards (PDF, class bundles, Excel); timetable with clash check; search; transport live tracking (behind a switch); multi-campus universities; 5 languages (partial).

## 2. Gaps, by area

Legend: **A** = automation gap (people do by hand what the system should do), **M** = missing feature, **U** = usability gap.

### 2.1 Notifications (foundation for everything)
- A: Absence email and monthly report email exist but nothing triggers them. Bus alerts queue without an email key.
- M: No in-app inbox or bell; no SMS, WhatsApp or app push; no delivery log; no per-parent channel preference; no templates.
- M: No notice when an announcement, homework, result, leave decision, fee due, feedback reply or admission decision happens.

### 2.2 School setup and data entry
- A: New school's first office login needs a script; academic year "2025-26" is hard-coded at creation.
- M: No screens for calendar events and holidays, staff leave types, buses, routes, stops.
- M: No staff bulk import; imports accept CSV only (Excel refused).
- U: No guided first-run setup (classes → subjects → staff → students → fees → timetable).
- M: No audit log of changes in CampusTwin.

### 2.3 Admissions
- A: "Admitted" does not create the student, guardian and login.
- M: No document upload, application fee, entrance test or interview slots, merit list, seat limits per class.
- A: No acknowledgement or follow-up reminders to parents or counsellors.

### 2.4 Student records and certificates
- M: No Aadhaar, APAAR (ABC) ID, UDISE+/PEN, blood group, category, religion, mother tongue, medical notes, sibling links, house.
- M: No transfer certificate, bonafide, character, conduct or fee certificates; no printable ID cards with photo and QR.
- M: No UDISE+ / board registration data exports.

### 2.5 Attendance
- A: Approved student leave does not mark attendance as leave; no parent alert on absence.
- M: No period-wise marking screen; no QR, RFID, biometric or face capture; no staff attendance.
- M: No attendance register export (monthly register in board format).

### 2.6 Fees
- M: No online payment (UPI, cards, net banking) or pay button for parents.
- M: No instalment plans, concessions (sibling, staff ward, RTE, category, merit), scholarships, late fees, fines, refunds policy, advance fees.
- A: No due and overdue reminders; no automatic late fee; library and transport charges not in fees; nothing posted to Finance.
- M: No fee defaulter workflow, demand notice, fee certificate for income tax.

### 2.7 Academics, exams, report cards
- M: No grading scales, weightage across terms, CBSE/ICSE/state report formats, co-scholastic and holistic progress card (HPC tables exist, no screen), remarks, rank, signatures.
- M: No exam timetable, admit cards, seating plans, invigilation duty; no marks import/export from Excel; no moderation or lock.
- A: Promotion is not suggested from results; no automatic transfer certificate for leavers.
- M: Teacher observations shown but cannot be written; homework has no file attachments.
- M: No lesson plans or syllabus coverage; no question bank or online tests.

### 2.8 Timetable and staff
- A: No automatic timetable generation; no substitution suggestions when a teacher is absent.
- M: No staff attendance, statutory payroll (PF, ESI, TDS computed), bank transfer file; leave types not editable.

### 2.9 Transport
- M: No screens for buses, routes, stops, drivers; transport fees not linked; whole tab hidden by a switch.

### 2.10 Communication and engagement
- M: No two-way parent-teacher messages; no parent-teacher meeting booking; no circular acknowledgement; no photo gallery; announcements cannot be scheduled.

### 2.11 Operations
- M: Hostel, visitor and gate pass, health and infirmary, inventory and store, canteen.

### 2.12 Access and devices
- M: No installable app (PWA) or native apps; no phone OTP login for parents.
- U: Fees, HR, library, admissions, homework, schedule and manage screens are English-only; PDFs English-only.

### 2.13 Higher education (colleges and universities)
- M: CBCS (electives, credits), regulations, semesters and course registration, OBE (CO-PO mapping, attainment), NAAC/NBA/NIRF reports, exam evaluation (valuation, revaluation), mentoring, placements, PhD.

## 3. Build plan

Each phase ships working screens, tests on the sample institutions, and a live deploy before the next starts.

**Phase 1. Notifications and setup (foundation)**
1. Notification engine: in-app inbox and bell, email, SMS and WhatsApp through one adapter, templates per event in all supported languages, per-guardian channel choice, delivery log, retries, quiet hours.
2. Wire every event: absence, late arrival, leave decision, announcement, homework set and due, result released, monthly report, fee due/overdue/receipt, admission status, feedback reply, bus alerts.
3. Setup wizard for a new school, first office login from the console, academic years created from screens.
4. Screens for calendar and holidays, staff leave types, buses, routes and stops.
5. Excel import (and CSV) for students, guardians, staff and books, with row-by-row error report.
6. Audit log.

**Phase 2. Fees, fully automatic**
1. Online payment (UPI, cards, net banking) with a pay button for parents and automatic receipting.
2. Instalment plans, concessions, scholarships, late-fee rules, advance and refunds.
3. Automatic reminders, defaulter list, demand notices, fee certificates.
4. Transport and library charges flow into fees; posting to Eternity Finance.

**Phase 3. Admissions to student, records and certificates**
1. Admission pipeline: documents, application fee, test/interview slots, seat limits, merit list, one-click "Admit" that creates student, guardian, login and first fee invoice.
2. Full student profile (APAAR, UDISE+/PEN, Aadhaar, medical, category, siblings, house).
3. Certificates and ID cards with templates, QR verification, bulk print.
4. UDISE+ and board registration exports.

**Phase 4. Academics and exams**
1. Grading scales, term weightage, board report formats (CBSE first), co-scholastic and holistic progress card, remarks, rank, signatures.
2. Exam timetable, admit cards, seating plans, invigilation.
3. Marks Excel import/export, moderation and lock; promotion suggested from results.
4. Homework attachments, teacher observations, lesson plans and syllabus tracking.

**Phase 5. Attendance and timetable automation**
1. Leave marks attendance automatically; period-wise attendance; QR attendance; staff attendance.
2. Automatic timetable generator and substitution suggestions.

**Phase 6. Phone app and access**
1. Installable app (PWA) with push notifications; phone OTP login for parents.
2. Every screen and PDF translated.

**Phase 7. Operations**
Hostel, visitor and gate pass, health, inventory and store.

**Phase 8. Higher education**
CBCS, semesters and registration, OBE and accreditation reports, evaluation, mentoring, placements.

**Last. Twin AI** across all of it.

## 4. Owner decisions (26 Nov 2026)
- **Payments:** each school connects its own merchant account(s). The school chooses from the gateways we support (Razorpay, Cashfree, PayU, more later), enters and updates its own credentials, and can attach several at once. Money goes straight to the school; Eternity never holds it (avoids RBI payment-aggregator rules). Build a gateway adapter layer with per-school encrypted keys.
- **SMS / WhatsApp:** provider decided later. Build the notification engine with in-app notices first and a pluggable channel adapter; write templates as fixed text with variables so they pass DLT approval later.
- **Email:** later (code already uses Resend; no key yet).
- **Report cards:** no fixed board. Each school picks the formats it needs, and one school can run several boards (for example a CBSE section and a state-board section), so the board/format is set per class or section. Build a report-card format system, with CBSE, ICSE and state formats as presets the school can choose.

## 5. Progress log
- 26 Nov 2026, live and tested on Greenfield:
  - New schools and campuses get the current April-March academic year (no fixed 2025-26).
  - Console gives a school its first principal or office login (duplicate emails refused with a clear message).
  - Approved student leave marks attendance as leave (past and future days); the register pre-selects leave; withdrawing approval restores absent (0060, self-test scripts/test-leave-attendance.sql).
  - Admissions: Admit creates student, parent (Google sign-in ready) and class place in one step, with the next admission number suggested in the school's own pattern; never twice (0061, end-to-end test apps/desk/.test-admit.mjs, 11/11).
  - Alumni directory no longer exposes contact details (0059).
- 26 Nov, live and tested: school calendar managed by principal/office (holidays, exams, PTMs, date ranges, national holidays; register opens as holiday; holidays not counted as staff leave; 10/10). Leave types for every school (9 had none) with an office editor (0062; 7/7). Transport switched on per school with Buses and Routes setup: buses, routes, ordered stops located by phone or pasted Google Maps link, distances computed, runs with driver and conductor (11/11).
- 26 Nov: Excel (.xlsx) accepted for student and library uploads (dependency-free reader, dates included); new bulk staff upload (roles in plain words, update by code or email). Found and fixed three saves broken for every school since multi-school support (bulk student upload, library import, bell schedule) because they matched on old single-column keys (11/11).
- 26 Nov: Plans decide modules (0063/0064): Standard/Professional/Enterprise editable on console Plans; modules = plan + per-school exceptions; editing a plan updates every school on it; campuses follow their university; existing schools kept their modules (8/8). School admin for each school's office/principal (0065): plan comparison and upgrade request (approved in the console), usage, append-only change history (field names only), logins and every sign-in, own-portal health; isolation verified (10/10). Phase 1 audit log item done.
- 26 Nov: Fees step 1 (0066-0068): instalment plans with presets, heads split or once a year, whole-school raising in one step (270 invoices in 0.9s) with exact rounding, concession types (percent/yearly amount, per head, automatic sibling) and per-student concessions, totals kept by the database (13/13 on Greenfield). Fixed: receipt numbers collided on every sample school (shared counter restarted after the move) - now per school. Next: late fees, transport charges, advances/refunds, defaulters and demand notices, tuition certificate, Finance posting; online gateways tested later.
- 26 Nov: Fees step 2 (0069/0070): late fee rule (off by default, preview, nightly, one summary line in Activity, waivers), transport fee per route on instalments, dues by days overdue with demand notices PDF, yearly fee certificate with tuition (office and parents), nightly posting of collections to Eternity Finance (cash/bank, fee/transport income; older payments not posted). 10/10 on Greenfield + SQL self-test. Left in fees: online gateways (test later), reminders (with notifications).
- 26 Nov: Fee letters on request (0071): parent asks (education loan, visa, scholarship, employer), office checks figures and issues with a number (FL-YYYY-NNNN, frozen) or declines with a note; family downloads. Education loan payment mode with lender and loan number. 11/11 on Greenfield.
- 26 Nov: Restructure phases 1 and 2 live (design: Claude Doc 'CampusTwin structure'). Phase 1: src/core + src/editions/{school,college,university} + registry; one route registry for menu and page guard; boundary check in every deploy; access identical. Phase 2: grouped menu (Academics, Students, Fees, Campus, Staff, Settings), one Settings area (7 sections; fees split into structure, instalments, concessions, late fee), student records under Students, Today's work on office/principal home, all old addresses redirect, transport charged per route (sample schools moved; real school untouched). Gate: 12/12 suites incl. new structure test. Fixed on the way: late-fee guard let an office run all schools (0073).
- 27 Nov: SECURITY fix: anyone signed in could edit their own login row and make themselves office (0079). One person at several institutions (person_membership; the website decides the institution per request; switcher; not-a-member page; sign-in reuses one login; allowed email domains) (0078-0083). Student profile page with identity details for office/principal only, details upload, Admit prefill (0075-0076). Settings: Institution profile (0084). Certificates uploaded by the office as PDFs (single, bulk by admission number, old register import, attach later, private links, withdraw) (0085-0088). Student ID cards generated with QR, 8 per A4, reprint same card, lost card revoked; public check verify.campustwin.org (0089). Tests: two-institutions 8/8, sign-in matching 8/8, profile 8/8, certificates 9/9, ID cards 7/7.
- Owner (26 Nov): loans and fee letters on request are for colleges and universities only. Institutions now have a type (school/college, console settings); university campuses count as higher education (0072). Verified: Lakeview College has them, Greenfield (school) does not.
- Owner (26 Nov): no advance payments in school fees; advance payment only for schools paying Eternity for plan upgrades.
- Owner (26 Nov): notifications (inbox, email, SMS, WhatsApp) move to the END, after every product's features are complete end to end. Phase 1 continues with setup screens, imports and audit log; then fees, certificates, academics.
- Owner (27 Nov night): work through the night without asking; Fable acts as product head + CTO reviewer for every feature. Setup checklist and phone app at the very end for all products. Online payment and notifications built now, credentials added later by each institution. Email = Amazon SES; SMS and WhatsApp provider undecided (generic connector); payment gateways many (BillDesk, Paytm, Razorpay...), institution decides. Report cards: build the SYSTEM (schemes per class/section, two boards possible), no fixed board formats now.
- 27 Nov night: Speed: per-institution rules now evaluated once per query (0090). Certificates moved to a private bucket with no public address.
- 27 Nov night: Notifications (0091-0094, 0096-0097): inbox and bell for everyone; Settings, Messages and alerts: email (Amazon SES), SMS and WhatsApp (any provider by its web address, keys in Vault), test mode with no keys, which message goes on which channel, own wording with DLT / WhatsApp template ids, daily limits, quiet hours 9 pm-7 am for non-urgent, delivery log, test message. Events through an outbox (never blocks a save): absence (5-minute wait, correction message), fee receipt, fee due (one per parent per day, 3 days before, on the day, overdue weekly), leave requests to class teacher / principal, leave decisions, announcements (500 per batch; 1,681 parents in 0.5 s), attendance not marked by 10:30 to principal, report card published. Two product + CTO reviews fixed: Vault pointer, gateway-address SSRF, retries, stuck sends, fairness. Tests: SQL self-tests + live 15/15.
- 27 Nov night: Report cards (0095, 0100, 0101): schemes defined by the school (terms with optional dates, parts = exam type + sum/average/best N + scaled to, per-subject parts, grade bands with points, co-scholastic areas, subject order and counted/shown/hidden, pass marks per subject and overall); assigned per class with section overrides; computed in the database (47 students, full year, 0.2 s); exempt vs absent vs not entered; class teacher enters co-scholastic grades, remarks, result line, manual attendance; lock marks (also guards exams); publish frozen snapshots; class PDF and parent download; QR check without marks; parents notified. Reviewed twice. Live 13/13.
- 27 Nov night: Online fee payment, database (0098): gateway-neutral orders, amount from the bill, credited once, receipt + Finance posting as office payments (mode online), keys in Vault, expired attempts. Grants on every new table tightened (0099). Older Eternity Core and Alumni SQL tests are stale (written before memberships and alumni privacy), not tonight's regressions; to update later.
- 27 Nov night: Online fee payment complete (0104, 0105, 0108): gateway connector interface with a built-in test gateway (demo institutions only); several gateways per institution with their own keys (audited); Pay buttons on family bills, result page, webhook endpoint for real gateways; never credited twice; amount mismatches and late money kept for review with refund due; refunds and chargebacks; test receipts never posted to Finance; Settings, Online payment with a needs-attention list and Resolve. Reviewed twice. Live 11/11. Real gateway connectors (BillDesk, Paytm, Razorpay...) are added when an institution's merchant account is ready.
- 27 Nov night: Marks in Excel: a whole section and term in one sheet, upload with a cell-by-cell report; exempt marks (live 7/7). Exam timetable and admit cards (0106, 0108): exams with papers per class (theory/practical/oral, optional groups), clash check, marks columns created and kept in step, publish, parents told, admit cards with QR (held back for overdue fees if chosen), family date sheet and download. Reviewed. Live 8/8. Digital ID card and details for parents and students (0107; live 7/7).
