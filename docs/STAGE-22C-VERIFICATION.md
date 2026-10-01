# Stage 22C verification — v0.1.25

Checked on 2026-09-24 against the integrated Stage 22C release. The browser and native PostgreSQL qualification gates remain open.

## Executed checks

| Command/check | Result |
| --- | --- |
| `npm run db:generate` | Passed; additive schema generates the Prisma client |
| `node node_modules/vitest/vitest.mjs run tests/inspections.test.ts --maxWorkers=1 --testTimeout=20000` | 19 focused tests passed |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000` | 265 tests passed across 30 files |
| `npm run test:local-db` | 13 tests passed |
| `npx playwright test --config playwright.local.config.ts --grep 'inspection HTTP' --reporter line` | Two request-only scenarios passed through real authenticated Next.js routes |
| `npm run lint` | Passed without ESLint errors or warnings |
| `npm run build` | Passed including Prisma generation, worker build, TypeScript checking and production compilation |
| Prettier check on new service/image/UI/tests and E2E file | Passed |
| Historical migration byte comparison with v0.1.24 ZIP | All 17 historical SQL migrations and migration lock unchanged |
| Package-lock dependency graph comparison | Unchanged; release version only |
| `npx playwright install chromium` | Failed: downloaded browser archives were invalid/truncated |
| `npx playwright test --config playwright.local.config.ts --grep 'guided inspection' --project desktop-chromium --reporter line` | Blocked at browser launch: Chromium executable missing |

The two HTTP executions use the configured desktop/mobile project names but do not launch browsers or prove mobile rendering. The actual browser test includes labelled controls, photo selection/preview, navigation away and Back with draft restoration, submission receipt, viewport overflow and shift completion. It is provided for execution where Chromium is available.

## What the tests verify

Inspection tests apply the complete 18-migration chain to disposable PGlite and use real Prisma transactions, image decoding/re-encoding, local private file storage and downloads. They cover complete required views; damage and issue notes; missing/reused/corrupt/unsupported images; running versus paused shifts; expired/inactive assignments/vehicles; live access revocation; cross-tenant and peer isolation; existing administrator read access; exact replay, content conflicts and uniqueness; unchanged running time; immutable inspection/report/photo/object pointers; and retained author access after assignment end.

Two fault-injection tests exercise storage and assignment changes during upload with actual stored bytes. A transaction-outcome test simulates an uncertain database response: bytes remain for reconciliation, while known aborted operations remove their uncommitted files. This is not a native network-partition or concurrency qualification.

The authenticated HTTP test performs actual sign-in, shift start, missing-view and origin rejection, multipart upload, exact replay, private download, administrator read, administrator submission denial and shift finish.

## Review and recovery observations

A separate code reviewer found an in-app navigation draft-loss issue. The fix retains one draft and pending exact command in tab memory, scoped by actor/shift/assignment, and restores it after client-side navigation. Photo previews own and revoke only their display URLs. Confirmed submissions show a receipt independently of the history refresh. The reviewer found no remaining blocker in the fix; actual browser behavior is still unverified.

Initial verification caught type errors, which were corrected before the successful production build. The existing development Turbopack cache could not be opened; the disposable cache was preserved aside and regenerated. The first cold HTTP run exceeded its 30-second test budget after completing the report assertions; a 90-second test timeout accommodates the existing authentication quiet window and cold route compilation. No authentication rate limit or application validation was relaxed.

## Remaining gates

- Docker is unavailable: no native PostgreSQL 18.6 Docker migration/backup/restore or race test was executed here.
- PGlite is disposable test infrastructure; it remains separate from normal development and production databases.
- Browser visual, keyboard, camera/device, navigation and accessibility acceptance must be run on an actual browser using the included specification and Stage 22C checklist.
- Production object storage, retention, complete database-plus-photo recovery, load and native uncertain-commit reconciliation remain deployment qualification work.
- This is a feature implementation checkpoint for user testing, not a production readiness certification.
