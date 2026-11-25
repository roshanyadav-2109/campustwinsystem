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
