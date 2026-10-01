# Stage 22A verification

Version 0.1.23.

- Full suite: `npx vitest run --maxWorkers=1 --testTimeout=20000` — 234 tests passed across 28 files in 63.60 seconds.
- Ten new database/service tests cover work/break transitions, multiple breaks, finishing during a break, exact break duration, duplicate-key replay, stale commands, supplied timestamps, generic write denial, live membership/driver status, existing manual entries/corrections, immutable events, active-clock uniqueness and actual peer-record isolation.
- The first new test attempt could not import the not-yet-created clock service. The initial implemented six cases passed. Expanded constraint tests exposed PGlite socket teardown problems after intentional database errors; constraint assertions now execute directly on the same disposable engine, while service behaviour remains tested through Prisma. Final execution has no unhandled errors.
- Authenticated HTTP lifecycle test: two passed (the same HTTP case in both Playwright project configurations), 30.4 seconds. It used the real Next.js server and disposable fixture accounts to start, replay, pause, resume and finish a shift. These tests do not launch a browser.
- Production `npm run build` and `npm run lint` passed. TypeScript validation also passed during development and build.
- The migration applies in the disposable suite and retains existing manual-entry behaviour. No earlier migration file was changed.

The browser interaction test is included in e2e/workspace.spec.ts but was not executed: Chromium remains unavailable in this workspace after the Stage 22 download failure. The layout, keyboard interaction, reload workflow, uncertain-response UI and reduced-motion styling still need actual browser acceptance. No visual screenshot verification is claimed.

Native PostgreSQL concurrency is not certified by serial PGlite tests. Row locks and a database uniqueness constraint implement the safeguards, but the original Stage 23 native concurrency gate remains necessary. No live employee attendance, production database, payroll export or email was touched.
