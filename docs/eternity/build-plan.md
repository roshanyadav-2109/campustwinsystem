# Eternity build plan

Strategy and research: `docs/strategy/erp-blueprint.md`.

Rules for every step:
- Built and tested on **staging** (`uiakimzaixtfcklqlwqz`) first. Live (`gvfudrhdowlwvpbtctsl`) only after the owner's go-ahead.
- Every migration is idempotent and has a self-test that runs in a rolled-back transaction.
- `scripts/test-isolation.mjs` (tenant isolation) and `scripts/test-core.sql` must pass before any live apply.
- CampusTwin keeps working unchanged at every step; nothing is removed from schools.

## Phase 0: Eternity foundation

| Step | What | Status |
|---|---|---|
| 0.1 | `core` schema: organisations, products, plans, subscriptions, memberships, product access, append-only audit log; backfill; sync triggers; server-only access (migration `0053_eternity_core.sql`) | Done on staging, 13/13 core checks and 14/14 isolation checks pass. Live: waiting for go-ahead and a live database token |
| 0.2 | Expose `core` to the server API (`db_schema = public,graphql_public,core`) | Done on staging. Live: with 0.1 |
| 0.3 | One repository with npm workspaces: `apps/campustwin` (today's app, unchanged), `packages/core` (typed server client for core), `packages/ui` (console design, icons) | Next |
| 0.4 | Eternity console view of customers: organisations, their products and subscriptions, members, audit log | After 0.3 |
| 0.5 | Eternity ID: one sign-in for every product, organisation switcher, product switcher | Needs the Eternity domain |

## Phase 1: Eternity HR (first release)

Organisation structure, employee records for all staff, attendance and shifts, leave ledger, approvals with inbox and delegation, audit, employee self-service. Own app (`apps/hr`), own schema (`hr`), reads `core`. Runs on a workers.dev address until its domain is chosen.

## Open decisions (owner)

1. Eternity domain.
2. HR product name.
3. Live database access for applying migrations (a Supabase access token for the live project, or the owner runs the SQL in the dashboard).

## Status, 25 Nov 2026

- `0053_eternity_core.sql` (core) and `0054_hr.sql` (HR) applied on staging. Self-tests: `scripts/test-core.sql` 16/16, `scripts/test-hr.sql` 21/21, `scripts/test-isolation.mjs` 14/14.
- Eternity HR (`apps/hr`, Worker `eternity-hr`) live as a **preview on staging data** at https://hrms.campustwin.org. End-to-end through the real screens: 10/10. Demo data: `scripts/seed-hr-demo.sql` (staging only).
- Platform owners (`public.platform_owner`, today officeneuralai@gmail.com) administer HR in every organisation that has HR.
- Reserved sub-addresses (hrms, finance, alumni, learn, desk, id, console ...) are refused for schools and universities by the database.

Lessons fixed in code:
- On Workers, a server action that calls `redirect()` hangs; actions return `{ go }` and the browser navigates.
- Sign-in runs in the browser. Library versions are pinned to what CampusTwin runs in production.

### To take HR live (needs a live database token and the owner's go-ahead)
1. Apply `0053` and `0054` to live; expose `core,hr` in the live API settings.
2. Point the HR Worker at the live project (build env and `SUPABASE_SERVICE_ROLE_KEY` secret), set `GOOGLE_CLIENT_ID` and `HR_GOOGLE_SIGNIN=1`, drop `NEXT_PUBLIC_HR_PREVIEW`.
3. In CampusTwin's Google callback, recognise HR employees by email so HR-only staff can use Google (owners already work).
4. Give the first organisations an HR subscription from the console.

## Products after HR
Order: Eternity Finance, Eternity Alumni (directory, events, jobs, donations with 80G receipts, Form 113/114 export, FCRA checks, CSR grants; sold alone or linked to CampusTwin), Learn, Desk.
