# Stage 13 verification — 0.1.13

Checked 2026-09-15 against this source checkpoint.

| Check                             | Result                           |
| --------------------------------- | -------------------------------- |
| Prisma client generation          | Passed                           |
| TypeScript strict project check   | Passed                           |
| ESLint                            | Passed                           |
| Score worker compilation          | Passed                           |
| Full Vitest suite                 | 170 tests passed across 21 files |
| New stock-alert integration tests | Ten passed                       |

New tests cover one notification per shortage episode, recovery resolution and recurrence, already-low configuration and equality boundaries, custody issue/return hooks, competing reconciliations and preserved read state, stale/foreign/driver recipient rejection, revoked staff permissions, unavailable-recipient suppression and reactivation, self-selection in the staff picker, disabled/zero thresholds, driver-role notification filtering, recipient changes within an episode, and version checks for edits to the existing minimum-stock field.

The full suite also verifies previous migrations and stock/custody behavior with the new migration applied. It uses disposable PGlite databases. No operational database was migrated, no deployment job was scheduled, and no messages were sent to real people.

Native PostgreSQL concurrency/load validation, production scheduling/monitoring, browser/mobile/accessibility checks and actual deployment remain pending. Follow `STAGE-13.md` for upgrade and acceptance steps.

Next.js production build and formatting checks for Stage 13 code changes: passed.
