> Execution checkpoint: see `RELEASE_STATUS.md` for verified completion. Checkboxes below preserve the original plan rather than claiming all target requirements passed.

# Fleet Platform Implementation Plan

> For agentic workers: use subagent-driven-development for bounded delegated tasks and inline execution for shared integration work.

Goal: implement the approved German React/Next.js fleet platform with PostgreSQL persistence and deny-by-default access.

Architecture: Node modular monolith. Route handlers and server pages call authenticated domain services. PostgreSQL enforces relational integrity; private files pass quarantine checks.

Tech stack: Next.js 16.3.4, React 19.2.8, TypeScript 6, Prisma 7, PostgreSQL 18, Better Auth, Vitest, Playwright.

Spec: ARCHITECTURE.md, DATA_MODEL.md, AUTHORIZATION.md and the uploaded master build prompt.

## Global constraints

German UI; English identifiers. No business data in localStorage. Server authorization on every protected operation. No universal production credentials. No deprecated or prerelease production dependency. Never describe unexecuted checks as passing.

## Task 1: Research, database and identity

- [ ] Close remaining dependency documentation checks and save evidence.
- [ ] Create prisma/schema.prisma, prisma.config.ts, src/server/db.ts, src/server/auth.ts and migrations.
- [ ] Add authorization tests before the policy implementation. Required cases: driver cannot manage vehicles; driver cannot read foreign organization; own score cannot accept a different driver ID.
- [ ] Expose Principal `{ userId, organizationId, role, driverId, name, email }` and `requirePrincipal(): Promise<Principal>`.
- [ ] Add secure seed/provisioning scripts; development seed requires explicit credentials from environment and refuses production.

## Task 2: Fleet domain

- [ ] Create src/features/fleet/service.ts and tests/integration.test.ts.
- [ ] Tests first: two concurrent assignments for one vehicle yield exactly one success; rented vehicle requires provider; archiving active assignment is rejected; return to fleet preserves service periods.
- [ ] Add drivers, vehicles, categories, assignments, key custody, lifecycle and audit transactions.
- [ ] Expose `/api/v1/[module]` GET and POST with shared schemas. GET returns `{items, total, page, pageSize}`. POST accepts `{action, id?, data?}` and returns `{ok:true, item?}` or a German error with HTTP status.

## Task 3: Operations and private files

- [ ] Implement plan, wave state transitions, work times/revisions, inventory movements, messages/participants, notifications and reports.
- [ ] Tests first: invalid wave transition denied; negative stock prevented; foreign thread access denied; approved time correction leaves old revision.
- [ ] Implement bounded file parsing, private retrieval and authorized file subjects; source files never become public assets.

## Task 4: Scores

- [ ] Implement CSV/XLSX validated draft preview, commit/history/revert and configurable columns.
- [ ] Tests first: formulas rejected, duplicate commit prevented, foreign driver ID rejected, missing values remain missing.
- [ ] Driver score response uses principal driver scope before fetching and includes no other driver rows.

## Task 5: React interface

- [ ] Build server layout and page loading using Principal and list DTOs.
- [ ] Build German shell, dashboard, table/filter/forms, feature pages, mobile score/history, theme and profile menu.
- [ ] Browser cases: login, vehicle creation, assignment, import, own score, keyboard dialog, logout.
- [ ] Keep visible strings in src/messages/de.ts. No marketing-style hero in the internal dashboard.

## Task 6: Verification and delivery

- [ ] Run format/lint/typecheck, domain and database tests, E2E, production build and dependency scan.
- [ ] Review authorization and file paths independently; correct findings before delivery.
- [ ] Write final implementation-aligned operations/API/extension docs, Docker/CI, seed instructions and screenshots.
- [ ] Package source without secrets, node_modules, database bytes or build caches. Record exact completed/blocked checks and retain unfinished scope honestly.

## Execution rulings

- User approved implementation and the React/Next.js architecture. Continue through reversible work without another design-approval pause.
- New isolated local repository on build/v1; no existing user branch is modified. GitHub was declined; deliver downloadable source.
- Native Sites starter differs from approved Node/PostgreSQL architecture. Preserve approved stack; do not substitute D1 or Vinext.
- Release remains 0.1.0 during development. Change to v1.0.0 only when the supplied definition of done is met.
