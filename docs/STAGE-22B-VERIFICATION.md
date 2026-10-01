# Stage 22B verification — v0.1.24

Executed on 2026-09-16 against the combined Stage 22A, Stage 22B and local database tooling source.

| Command/check | Result |
| --- | --- |
| `npm run db:generate` | Passed |
| `node node_modules/vitest/vitest.mjs run tests/time-corrections.test.ts --maxWorkers=1 --testTimeout=20000` | 12 tests passed |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000` | 246 tests passed across 29 files |
| `npm run test:local-db` | 13 tests passed |
| `npx playwright test --config playwright.local.config.ts --grep 'correction HTTP' --reporter line` | Two authenticated HTTP scenarios passed, one per configured desktop/mobile project |
| `npm run lint` | Passed without ESLint errors or warnings |
| `npm run build` | Passed, including TypeScript checking and Next.js production compilation |
| Historical migration comparison against delivered v0.1.23 ZIP | All 17 existing migration-directory files byte-identical (16 SQL migrations plus migration lock file) |

The new correction migration brings the chain to 17 SQL migrations. No historical migration was rewritten. The dependency graph is unchanged from Stage 22A; package and lockfile release versions are updated.

## Coverage

The correction tests execute the migration chain and service transactions against disposable PGlite. They cover request and decision replay, identifier conflicts, version conflicts, duplicate pending requests, future/invalid/no-op proposals, overlap checks, legacy whole-minute breaks, revoked membership, dispatcher denial, cross-tenant and peer isolation, self-approval denial, private evidence pinning after document archival, immutable requests/decisions and preservation of original clock events. Approval resets the work-time approval status and records a revision and audit trail.

The HTTP scenarios exercise actual login, driver clock commands, proposal submission, employee decision denial, administrator approval/replay and the resulting driver-visible values through Next.js API routes. These are request-only scenarios: the two Playwright project configurations do not constitute desktop/mobile browser rendering tests.

The targeted tests were first run against the missing service to establish a failing baseline. An expanded fixture initially left a shift open and caused subsequent overlap failures; fixture cleanup was corrected without relaxing the production checks. The final targeted and complete suites pass.

## Remaining qualification

- Chromium is absent: actual browser interactions, layout, keyboard and accessibility acceptance remain pending. Use the checklist in `STAGE-22B.md`.
- Docker is unavailable: the supplied `npm run test:local-db:docker` disposable PostgreSQL acceptance suite was not executed here. The earlier tooling verification report is retained separately.
- PGlite transaction tests do not prove native PostgreSQL concurrency behavior. Native locking/race qualification remains an open release gate.
- Evidence authorization tests mock byte retrieval. Live private storage and malware scanner integration are separate deployment checks.
- This is an implementation checkpoint for user testing, not a production-readiness certification.
