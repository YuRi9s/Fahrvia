# Stage 10 verification — 0.1.10

Checked 2026-09-15 against the delivered source.

| Check                           | Result                           |
| ------------------------------- | -------------------------------- |
| Prisma client generation        | Passed                           |
| TypeScript strict project check | Passed                           |
| ESLint                          | Passed                           |
| Score worker compilation        | Passed                           |
| Full Vitest suite               | 145 tests passed across 18 files |
| New wave integration tests      | Eight passed                     |

Wave coverage includes multiple participant pairs and listing, duplicate/cross-tenant/inactive rejection, required participants and legal transitions, incomplete-delivery rejection, competing starts and stale versions, frozen active composition, progress bounds, tenant/role/revoked-membership checks, preservation of an existing wave during migration, and prevention of resource archival during an active wave.

The migration check applies the pre-stage schema to a disposable database, inserts an existing single-participant ACTIVE wave, applies the new migration, and verifies participant identities, status and package/delivery totals. Integration tests use PGlite. The concurrency checks do not replace native PostgreSQL concurrency/load qualification.

No operational database was migrated or reset. Browser/mobile/accessibility testing, real deployment, native concurrency and upgrade validation against the user's database copy remain pending. Follow `STAGE-10.md` before upgrading.

Next.js production build and formatting checks for Stage 10 code changes: passed.
