# Stage 2 verification — 2026-09-09

Version 0.1.2.

- Full automated suite: 71 tests passed across 10 files.
- New calendar suite: 9 tests passed; also passed with `TZ=America/New_York` and `TZ=Asia/Tokyo`.
- Database integration: 18 tests passed, including Berlin Monday and exclusive next-week filtering using actual Prisma queries against disposable PGlite.
- TypeScript and ESLint passed.
- Production build and formatting checked before packaging.

Three initial regressions failed against the old implementation: Berlin week selection, DST week duration and acceptance of timezone-free operational timestamps. After the change, the full suite also identified a missing helper in the isolated score-worker build. Its build manifest now includes the new timezone helper; score-worker and score-import integration tests passed afterward.

Browser interaction, mobile appearance and animation timing were not executed here. Native PostgreSQL concurrency, external-service integration, deployment and backup recovery remain open production gates. No credentials, stored timestamps or schema were changed.
