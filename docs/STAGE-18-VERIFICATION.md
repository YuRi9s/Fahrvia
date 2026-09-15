# Stage 18 verification

Version 0.1.18, implementation checkpoint.

- Full automated suite: **199 tests passed across 24 files**.
- Ten new list tests verify whole-result numeric ordering, stable tied values across pages, derived document statuses, combined search/status/ownership, source-defined score statuses beyond page 1, driver vehicle restrictions, report filtering, invalid parameters, empty results and every advertised sort field in both directions.
- The existing driver ownership regression now expects an empty AVAILABLE result for an assigned vehicle, matching the newly applied status filter. The adjacent ASSIGNED test still verifies the permitted vehicle remains visible.
- TypeScript passed; the final Next.js production build also completed its TypeScript check.
- ESLint passed without warnings. Changed source/test files passed Prettier checks.
- Prisma generation, score-worker compilation and the production build passed.

Automated database checks use PGlite. Browser/mobile/accessibility acceptance, real PostgreSQL concurrency and production deployment remain pending. No operational database was changed, no live account was modified and no migration was added for this stage.

Follow `STAGE-18.md` for manual tests. Generic counts and rows remain separate reads, so concurrent writes can briefly change totals between reads; stable ID tie-breakers do not provide a cross-request snapshot.
