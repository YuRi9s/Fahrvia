# Stage 11 verification — 0.1.11

Checked 2026-09-15 against this source checkpoint.

| Check                                   | Result                           |
| --------------------------------------- | -------------------------------- |
| Prisma client generation                | Passed                           |
| TypeScript strict project check         | Passed                           |
| ESLint                                  | Passed                           |
| Score worker compilation                | Passed                           |
| Full Vitest suite                       | 154 tests passed across 19 files |
| New inventory-custody integration tests | Nine passed                      |

New tests cover driver and vehicle issue, partial/full return, stock restoration and movement quantities, invalid/foreign/inactive recipients, competing issues without negative stock, repeated issue requests and changed replay payloads, excess/stale/duplicate returns, pagination and complete outstanding totals, tenant/role/live-permission enforcement, returns after recipient archival, quantity/reason validation, and migration preservation of existing stock and adjustments.

The upgrade test applies pre-stage migrations to a disposable database, inserts an existing item and adjustment, applies the custody migration, and verifies unchanged stock, movement quantity/reason, default ADJUST type and empty custody history. No historical custody is inferred.

Integration tests use PGlite. Native PostgreSQL concurrency/load testing and upgrade verification against a copy of the user's database remain pending. Browser/mobile/accessibility checks and actual deployment are unverified. No operational database was migrated or reset. Follow `STAGE-11.md` before upgrading.

Next.js production build, including `/api/v1/inventory-custody`, and formatting checks for Stage 11 code changes: passed.
