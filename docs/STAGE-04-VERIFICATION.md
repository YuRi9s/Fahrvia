# Stage 4 verification — 2026-09-09

Version 0.1.4.

| Check                          | Result                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest suite              | 97 tests passed across 12 files                                                                                                                           |
| Account integration suite      | 11 tests passed using real Prisma queries and disposable PGlite                                                                                           |
| Authentication                 | Real Better Auth sign-in; role changes and access changes invalidate existing sessions; fresh sign-in succeeds after restoration                          |
| Authorization                  | Tenant boundaries, protected self/super-administrator accounts, restricted ADMIN grants and current actor privileges checked                              |
| State and history              | Stale versions rejected, before/after/reason audited, linked driver history preserved, archived driver access denied, second active organization rejected |
| Invitations                    | Links remain invalid after the issuing administrator is disabled and restored                                                                             |
| Driver archive                 | Archiving a former driver preserves their promoted administrator membership                                                                               |
| Conflicting edits              | Two submissions using the same version produce one successful mutation and one audit record with the single-connection PGlite adapter                     |
| Migration                      | Existing membership identity, role and disabled state preserved; version initialized to 1                                                                 |
| TypeScript / ESLint / Prettier | Passed                                                                                                                                                    |
| Production build               | Passed; clean Next.js build includes `/api/v1/accounts` and the existing dynamic workspace                                                                |

The first targeted run hit the existing sign-in throttle because the identity test performs several rapid logins. Only disposable test rate-limit records are reset between these assertions; production throttling remains enabled. The full regression run also caught a schema-edit overmatch that added an invitation-only field to two unrelated models. The schema was corrected, the client regenerated, and the full suite rerun successfully.

Verification used separate client generation, score-worker compilation and `next build`, the same build steps defined by `npm run build`. No production database or live email recipient was changed. Browser interaction, visual/mobile/keyboard acceptance, real PostgreSQL concurrency and deployment remain unexecuted qualification gates. This stage is an implementation handoff, not a production v1 certification.
