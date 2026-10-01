# Stage 14A verification

Verified on 2026-10-01. Source baseline: v0.1.25; delivery: v0.1.26.

## Executed checks

- `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000`: 278 tests passed across 32 files. Uses migrated disposable PGlite databases for integration tests.
- `npm run test:local-db`: 13 passed.
- `npm run lint`: passed.
- `npm run build`: passed, including Prisma generation, worker build, TypeScript and production Next.js compilation.
- `node node_modules/@playwright/test/cli.js test --config playwright.local.config.ts e2e/score-excel.spec.ts --project=desktop-chromium`: 1 HTTP integration test passed. This test uses Playwright's request client; it does not launch Chromium or establish visual/browser acceptance.
- Compared the dependency lock against v0.1.25: only release-version metadata changed.
- Compared all historical SQL migrations against v0.1.25: byte-identical. One new additive migration.

Tests cover screenshot aliases, literal metric preservation, comma decimals, ignored columns, multiple sheets, invalid sheet names, unsuitable cover sheets, active content on unselected sheets, worker inspection, private filtered exports, text IDs, formula-looking export strings, size rejection, export/reimport values, inspection without database writes, saved selection, explicit revision replacement and stale previews. Existing parser hostile-input tests remain in the suite.

Review identified a worksheet-picker dead end when the first sheet exceeded table limits. Inspection now returns workbook metadata and a selected-sheet warning; choosing a valid sheet works. Global archive/XML active-content rejection remains intact. A regression test covers both warning and strict-import paths.

## Acceptance still required

- Real provider workbook compatibility and business interpretation: only screenshots were supplied. No provider scoring definitions or inferred percentage/date units were implemented.
- Browser visual/interaction acceptance: no Chromium executable is installed in this environment. Follow STAGE-14A.md on desktop and mobile; verify mapping changes invalidate the preview and replacement requires the checkbox.
- Native PostgreSQL/Docker deployment and concurrency qualification remain Stage 19/production gates. This stage does not claim production-v1 readiness.

## Changed files

- `CHANGELOG.md`
- `README.md`
- `docs/OPERATIONS.md`
- `docs/RELEASE_STATUS.md`
- `docs/SCORE_IMPORT.md`
- `docs/STAGE-14A-VERIFICATION.md`
- `docs/STAGE-14A.md`
- `docs/STAGES.md`
- `docs/superpowers/plans/2026-09-25-score-excel.md`
- `e2e/score-excel.spec.ts`
- `package-lock.json`
- `package.json`
- `prisma/migrations/20260925_score_selection/migration.sql`
- `prisma/schema.prisma`
- `src/app/api/v1/score-imports/[id]/route.ts`
- `src/app/api/v1/score/export/route.ts`
- `src/components/module-table.tsx`
- `src/components/score-import.tsx`
- `src/components/score-panel.tsx`
- `src/features/score/export.ts`
- `src/features/score/isolated-parser.ts`
- `src/features/score/parser.ts`
- `src/features/score/query.ts`
- `src/features/score/service.ts`
- `src/features/score/xlsx.ts`
- `src/server/queries.ts`
- `tests/integration.test.ts`
- `tests/score-excel.test.ts`
- `tests/score-export.test.ts`
- `tests/score-worker.test.ts`
- `workers/score/worker.mjs`
