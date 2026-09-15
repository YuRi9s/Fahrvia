# Stage 12 verification — 0.1.12

Checked 2026-09-15 against this source checkpoint.

| Check                                   | Result                           |
| --------------------------------------- | -------------------------------- |
| Prisma client generation                | Passed                           |
| TypeScript strict project check         | Passed                           |
| ESLint                                  | Passed                           |
| Score worker compilation                | Passed                           |
| Full Vitest suite                       | 160 tests passed across 20 files |
| New inventory-history integration tests | Six passed                       |

New tests cover adjustment/issue/return attribution and signed quantities, text/type searches including literal wildcard input, exclusive Berlin week boundaries, stable pagination with complete filtered totals, tenant isolation and driver denial, prevention of unscoped actor-name exposure, and rejection of movement updates/deletions by the database trigger.

Existing migration-preservation and inventory-custody tests also pass with the new migration applied. No operational database was migrated or reset. Tests use disposable PGlite databases; native PostgreSQL performance, production configuration and actual database upgrade remain separate qualification work.

Browser interaction, mobile/accessibility rendering, reduced-motion behavior and deployment remain unverified. Follow `STAGE-12.md` for upgrade and acceptance steps.

Next.js production build, including `/api/v1/inventory-movements`, and formatting checks for Stage 12 code changes: passed.
