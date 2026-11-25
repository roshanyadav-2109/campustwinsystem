# Eternity product blueprint (CampusTwin and HRMS)

Research date: 25 Nov 2026. Sources: Oracle Fusion Cloud ERP/HCM and Student Management docs, SAP S/4HANA, SuccessFactors and SLcM material, ten education ERPs (Fedena, Edumerge, Entab, Teachmint, MyClassboard, Classe365, Camu, Academia, Ellucian, Workday Student, Anthology, PowerSchool), and the source code of Frappe HR, ERPNext, Frappe Education, OpenEduCat and Fedena (read only; GPL/LGPL code is studied, never copied).

## 1. Where we stand

Strong today: academics (classes, timetable, attendance, homework, exams and marks, promotion, HPC), transport with live GPS, fees, admissions, library, announcements, multi-tenant isolation, university and campus registry, owner console with platform health.

Thin or missing, measured against Oracle/SAP-class systems:

| Area | Today | Gap |
|---|---|---|
| Staff model | `staff_role` enum: subject teacher, class teacher, principal, office, transport | No designations, departments, grades, employment types or reporting lines. Accountants, lab staff, wardens, drivers, security and housekeeping have nowhere to live |
| Permissions | Role checks inside RLS functions | No duties, no scoped grants (role + campus/department/classes), no segregation-of-duties checks |
| Payroll | One fixed salary row (basic, HRA, DA, PF, tax), monthly run, payslip | No salary components or formulas, no PF/ESI/PT/LWF/TDS engine, no arrears, increments, ECR files, Form 16 or full-and-final settlement |
| HR lifecycle | Staff leave with types | No staff attendance or shifts, biometric devices, recruitment, onboarding, probation, transfer or promotion records, appraisal, training, separation |
| Finance | Fee invoices and payments | No chart of accounts or ledger, no fee to journal posting, no expenses, purchase, inventory, fixed assets, budgets or Tally/GST |
| Platform | Per-feature status columns | No common document lifecycle, approval engine, delegation, audit trail, numbering series, effective dating, custom fields or import templates |
| Compliance | None | UDISE+/APAAR, AISHE, ABC/NAD/DigiLocker, NAAC/NBA/NIRF, DPDP consent |
| Higher ed | University and campus registry | No credit system, CBCS, multiple entry and exit, outcome-based education, examination control, research grants, hostel |

## 2. What the market tells us

No Indian vendor publicly documents UDISE+/APAAR sync, AISHE export, ABC/NAD upload and GST invoicing together. Only Camu documents ABC/NAD. That is open ground.

Most common complaints across all products, in order: cluttered navigation, reports that need a specialist, little self-configuration, slowness under load, buggy wrapped mobile apps, slow support, vendor hand-holding for routine tasks, implementation overruns, opaque pricing, and security failures (PowerSchool lost 62M records through a support portal with no MFA).

Positioning that follows: an Oracle-grade core with Indian education built in, and the ease of a consumer app. Fast, self-serve, transparent pricing, MFA everywhere.

## 3. Patterns worth copying from the leaders

1. **Separate hierarchies** (Oracle legal entity, business unit, ledger; SAP company code, controlling area, cost centre). For us: Trust or Society (legal entity) → Institution or Campus (business unit) → Faculty or Department (cost centre), as separate dimensions, stored as ltree paths.
2. **Reference data sets.** Fee heads, grade scales, subject catalogue and leave types defined once at group level, shared or overridden per campus.
3. **Duties → job roles → scoped grants.** "Fee clerk" granted for "Campus B" or "Classes 6 to 10". Users only ever receive job roles. RLS reads the grant table.
4. **Segregation of duties.** Flag or block one person holding both sides of a control (create concession and approve concession; add vendor and pay vendor), checked when a role is granted.
5. **Document lifecycle** (Frappe docstatus): draft → submitted → cancelled, with amend creating a linked new version. Submitted rows are never edited or deleted, only cancelled. Side effects (ledger postings) happen on submit and reverse on cancel.
6. **Ledgers instead of balances.** Leave balance = sum of a signed leave ledger. Money = double-entry general ledger. Library fines and stock later work the same way.
7. **Effective dating.** Salary assignments, shifts, leave policies, fee structures, tax slabs and statutory rates carry from and to dates with no-overlap constraints. "What was the fee on 1 April" is always answerable.
8. **Approval engine as data.** Workflow states and transitions per document type with role, ordered conditions, self-approval rule, a "simulate" button showing who will approve, one approval inbox, and dated delegation while someone is on leave.
9. **Numbering series.** Per tenant, per document type, per year: `RCPT-2026-00001`. Gapless for fee receipts and GST invoices, locked once in use.
10. **Audit trail.** One version table with JSON diffs of every change, who made it, and the impersonator if any. Optimistic locking so two people cannot overwrite each other.
11. **Typed custom fields and import templates.** Per-tenant extra fields with validation that flow into reports and exports; CSV/Excel templates with validate-then-commit and an error file.
12. **Two reporting tiers.** A self-serve report builder over a secured data layer, plus document templates for report cards, certificates, receipts and payslips. Both obey the same permissions.
13. **Role-based home pages** (SAP Fiori spaces): each role lands on its own tiles and pending approvals.
14. **Test-first releases.** A sandbox copy per institution that gets each release before production.

## 4. HRMS for every employee (the Eternity HRMS product)

Teaching and non-teaching staff are one entity; designation and department tell them apart.

- **Organisation:** department tree, designation, grade, employment type (permanent, contract, guest faculty, daily wage), branch or campus, reporting line, holiday list per campus.
- **Lifecycle:** joining, probation and confirmation, transfer and promotion as submitted records that update the employee, separation with a clearance checklist, full-and-final statement (unpaid salary, leave encashment, gratuity, recoveries, asset return).
- **Time:** shift types (day, night, split for wardens, drivers, security), shift rosters, check-ins from biometric devices, mobile geo-fence or RFID, converted daily into attendance with late and early rules.
- **Leave:** leave types with carry-forward, encashment, earned-leave accrual and compensatory off; policies assigned by effective date; balances from a leave ledger; approval through the workflow engine.
- **Payroll:** salary components with formulas and conditions, salary structures as templates, an assignment per employee with CTC, payroll runs by campus or department, payslips that snapshot every component, arrears and one-off additions, bank transfer files, posting to the general ledger.
- **Indian statutory engine (our edge; even Frappe HR lacks it):** an effective-dated, state-keyed rules table for PF (wage ceiling, VPF, EPS), ESI eligibility and rates, professional tax slabs by state, labour welfare fund, TDS under old and new regimes with declarations and proofs, gratuity. Outputs: PF ECR, ESI return, PT challan data, Form 16, Form 24Q data.
- **Also:** expense claims and advances, appraisal cycles with KRAs, recruitment (requisition, opening, applicant, interview, offer), training records, assets in an employee's custody, employee self-service on mobile.

## 5. Finance (CampusTwin fees now; a full accounts product later)

- Chart of accounts per legal entity, one immutable general ledger, cost-centre and campus dimensions on every row, period open and close.
- Fee structure (programme or class × year × category) → fee schedule → one invoice per student → receivable and income postings → receipts allocated against invoices. Refunds and concessions go through approvals.
- Payables: purchase request → purchase order → goods receipt → vendor bill → payment, with department budgets reserving funds at approval.
- Inventory and fixed assets with depreciation. Tally export. GST invoicing for non-exempt services (transport, canteen, hostel where taxable; confirm with a chartered accountant).
- Universities: research grants and projects with sponsor, budget and principal investigator; trust-level consolidation across institutions.

## 6. Academics and compliance

- **Higher education:** credits and CBCS, multiple entry and exit, two intakes a year, dual degrees under one student ID, outcome-based education (CO, PO and PSO mapping with attainment), Controller of Examinations workflow, hostel, placements, alumni, mentor-mentee and grievance (both feed NAAC criterion 5).
- **Schools:** CBSE-style continuous assessment (we have HPC), RTE quota tracking, gate and visitor log.
- **Government exports:** UDISE+ and APAAR for schools; AISHE DCF for colleges and universities; ABC/NAD credit upload keyed by APAAR ID (UGC deadlines already apply); NAAC SSR/AQAR evidence packs; NBA SAR; NIRF data.
- **DPDP Act:** verifiable parental consent for under-18s, breach notification and safeguards. Deadline about 14 May 2027.

## 7a. Products

Five products, built in order. Three core products cover an organisation's main work, its people and its money; two follow only on demand.

| Product | Status | For | Covers |
|---|---|---|---|
| CampusTwin | Live | Schools, colleges, universities | Academics, students, admissions, exams, attendance, timetable, homework, fees, transport, library, hostel, parent and student apps, government filings |
| Eternity HR (name to choose) | Next | Any organisation | Employee records, attendance and shifts, leave, payroll with PF, ESI, PT, LWF, TDS, recruitment, appraisal, separation, self-service app |
| Eternity Finance (name to choose) | After HR | Institutions, trusts, small businesses | Ledger, GST, expenses, purchase, inventory and assets, budgets, bank reconciliation, Tally export; fees and salaries post into it |
| Eternity Learn | On demand | Schools, colleges, coaching | Online courses, live classes, assignments, question banks, online tests |
| Eternity Desk | On demand | Any organisation serving people | Tickets, grievances with deadlines, help centre |

Bundles: CampusTwin Complete (CampusTwin, HR, Finance) and Eternity One (everything, priced per employee).

Shared by all, never sold on their own: Eternity ID (one sign-in), organisations and subscriptions, billing, messaging, audit, reports, company console, status page.

What moves where: CampusTwin keeps a light staff list and staff leave; its payroll moves to Eternity HR; fees stay in CampusTwin and post into Eternity Finance; homework stays, full online learning goes to Eternity Learn.

## 7. Product structure: Eternity, a family of products

Eternity is the parent company and platform, structured like Zoho: one company, several focused products, one account across them. CampusTwin is not split into a suite; it stays the academic product.

| Layer | What it is | Address (proposal) |
|---|---|---|
| Eternity website | Company site listing every product, pricing, sign-up | `eternity.<domain>` |
| Eternity ID | One sign-in for every product; organisations, members, which products each organisation has, billing and invoices | `id.eternity.<domain>` |
| Eternity Console | The company's internal console for all products: tenants, health, support, billing (today's `console.campustwin.org`, moved up a level) | `console.eternity.<domain>` |
| CampusTwin | Academic ERP for schools, colleges and universities, unchanged in shape | `campustwin.org`, institution addresses as today |
| Eternity HRMS (name to choose) | HR and payroll for any organisation: schools, hospitals, shops, companies | own domain, organisation picked at sign-in |
| Later products | For example accounts and GST, or admissions CRM, only when there is demand | own domains |
| Status page | Public uptime and incidents | `status.eternity.<domain>` |

Shared Eternity platform, built once and used by every product: Eternity ID (single sign-in with two-step login and Google), Organisations (members, admins, invitations), Subscriptions (products, modules, plans, seats), Billing (GST invoices, online payment), Messaging (email, SMS, WhatsApp), and one audit log format and file storage layout.

How it is built:

| Part | Decision | Why |
|---|---|---|
| Code | One repository with a folder per app (accounts, console, website, campustwin, hrms) and shared packages (design, icons, sign-in, database types) | Shared pieces change in one place; each app still deploys on its own |
| Hosting | Each app is its own Cloudflare Worker and domain, deployed only when its folder changes | A CampusTwin release never takes HRMS down |
| Sign-in | Eternity ID is the single sign-in provider; products redirect there and receive a session | Different domains cannot share cookies |
| Data | Eternity core (people, organisations, subscriptions, billing) kept separate from product data. Start in today's Supabase project with separate schemas; split a product into its own project when its size calls for it | Existing users keep their sign-in |
| Product links | Products publish events (employee joined, leave approved) and read each other through small APIs | Each product can be sold alone |
| Customers | One Eternity organisation maps to a CampusTwin institution or university and to an HRMS company | One customer record, many products |

How the products fit together, the way Zoho People, Zoho Books and Zoho CRM do:
- **One account.** A person signs in once at Eternity ID and moves between products without signing in again. Each product trusts Eternity's sign-in.
- **One organisation.** "The Suman Nirmal Minda School" exists once at Eternity level and subscribes to CampusTwin, HRMS, or both. Billing is per organisation, per product.
- **Each product owns its own data and database.** Products exchange only what they need through defined links, so one product can change or scale without breaking another.
- **A shared design system and console look**, so all products feel like one family while each stays focused.

When a school has both CampusTwin and HRMS:
- HRMS is the master record for every employee, teaching and non-teaching. CampusTwin receives teachers from it for classes, timetable and attendance.
- Teacher leave approved in HRMS shows in CampusTwin's timetable so substitutions can be planned.
- When a school has only CampusTwin, it keeps CampusTwin's current light staff list and staff leave, so nothing it uses today is taken away.

HRMS is built for any organisation, with an education pack for schools: academic-year leave cycles, teaching load and the CampusTwin link. The statutory payroll engine (PF, ESI, PT, LWF, TDS) is generic Indian payroll and sells to every kind of employer.

## 8. Recommended order

| Phase | Scope | Why |
|---|---|---|
| 0. Eternity foundation | Confirm name and domain; Eternity ID (single sign-in, organisations, members, product subscriptions, billing); shared design package; move the console up to Eternity level | Every product plugs into this once, instead of each building its own login and billing |
| 1. HRMS, first release | Organisation structure, employee records for all staff, attendance and shifts with biometric and phone check-in, leave ledger, approvals with inbox and delegation, audit trail, employee self-service | A product that sells on its own, to schools and beyond |
| 2. HRMS payroll | Salary components and structures, payroll runs, Indian statutory engine, bank files, PF ECR, ESI, Form 16, full-and-final settlement | The feature competitors lack |
| 3. CampusTwin and HRMS link | Staff sync, leave into timetable and substitutions, single sign-in between the two | Turns two products into one experience for schools |
| 4. CampusTwin depth | Government filings (UDISE+, APAAR, AISHE, ABC, NAAC, NIRF), DPDP consent, higher-education credits and outcome-based education, hostel, fee posting ready for accounts | CampusTwin's clearest market gap |
| 5. Next product | Accounts and GST (fees and payroll post into it), or another product chosen by demand | Completes the ERP picture for trusts and universities |

The platform patterns in section 3 (scoped roles, document lifecycle, numbering, approvals, audit, effective dating) are built inside HRMS first and then reused across products.

## 9. Decisions needed

1. **Eternity domain.** Do we own one, and which?
2. **HRMS product name.** A name of its own (as Zoho People), or "Eternity HRMS".
3. **Payroll.** Our own statutory engine (recommended), or hand off to a payroll provider.
4. **First customers for HRMS.** Schools already on CampusTwin (easiest), or any business from day one.

## 10. How products and purchases link

One shared core underneath, separate products on top (the Google and Zoho model).

- **Code:** one repository with folders `core`, `campustwin`, `hr`, `finance` and shared packages; each product deploys on its own.
- **Database:** one Postgres database with a schema per product (`core`, `campustwin`, `hr`, `finance`). Each product writes only its own schema and reads `core`. A schema moves to its own database only when size calls for it.
- **Core records:** organisation (stored once), person (one login), membership (person × organisation × role per product), subscription (organisation × product × plan × seats × period), invoice (one per organisation, a line per product).
- **Adding a product:** the admin adds it in Eternity ID and pays; the subscription activates; the product appears in the app switcher for people given access; HR offers to import staff from CampusTwin.
- **Access check on every request:** who is this, which organisation, does it have this product, which role here; cached for seconds. Expired subscription means read-only with a renew banner, never deletion.
- **Pricing units:** CampusTwin per student, HR per employee, Finance per organisation; bundles are plans that switch on several products.
- **Today's code:** the current Supabase project becomes core plus the CampusTwin schema (no re-registration); per-school module switches become subscriptions; the console moves up to Eternity level.
