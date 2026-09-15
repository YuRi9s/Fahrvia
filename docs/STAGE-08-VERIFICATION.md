# Stage 8 verification — 0.1.8

Checked 2026-09-15 against this source checkpoint.

| Check                       | Result                           |
| --------------------------- | -------------------------------- |
| TypeScript (`tsc --noEmit`) | Passed                           |
| ESLint                      | Passed                           |
| Score worker compilation    | Passed                           |
| Vitest full suite           | 130 tests passed across 16 files |
| Stage 8 coverage            | Seven new integration tests      |

New tests cover half-open Berlin day boundaries and overnight assignments, complete daily counts with paginated history, vehicle pagination and tenant/staff isolation, present availability versus historical occupancy, DST weeks and invalid dates, competing return requests with one audit entry, and revoked staff write access.

Integration tests use a disposable PGlite database. Their competing-request checks do not replace native PostgreSQL concurrency/load qualification. No operational database was reset. No schema migration was added.

Browser interaction, mobile layout, keyboard/screen-reader behavior, reduced-motion rendering and actual deployment remain unverified. Use the checklist in `STAGE-08.md`; this is an implementation checkpoint, not production certification.

Production Next.js build: passed, including the `/api/v1/assignment-board` route. Formatting check passed for the new assignment modules, components and tests.
