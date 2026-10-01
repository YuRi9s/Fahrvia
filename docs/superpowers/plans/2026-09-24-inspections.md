# Stage 22C Implementation Plan

**Goal:** Guided vehicle inspections tied to recorded working time and current assignment.
**Architecture:** Atomic multipart submission, existing private photo reports, additive immutable inspection relation, current membership/assignment checks inside a transaction.
**Tech Stack:** Next.js, React, Prisma, PostgreSQL, Sharp, Vitest/PGlite, Playwright.
**Spec:** ../specs/2026-09-24-inspections-design.md

## Constraints

Node >=24.19.0 <25. No new dependencies. Preserve existing security controls and migration history. Work time starts before inspection. No automatic roadworthiness clearance. Execute inline, without git publishing.

## Tasks

- [x] Add `tests/inspections.test.ts`: real SQL migrations and image decoding; assert one receipt on retries, complete views, damage evidence, live permission/assignment checks, scoped history/download and immutable records. Run the target suite and establish the missing-feature failure.
- [x] Add `VehicleInspection` and photo position in `prisma/schema.prisma` and additive `20260924_vehicle_inspections/migration.sql`. Use scoped foreign keys and database immutable evidence guards. Generate client.
- [x] Add `src/features/inspections/service.ts` exposing `submitInspection(p, form)` and `inspectionList(p, page)`. Extract existing image normalization into `src/features/uploads/image.ts`; preserve existing upload behavior. Add GET/POST `/api/v1/inspections` with existing origin/auth/body/rate controls.
- [x] Add `src/components/vehicle-inspections.tsx` with guided metadata/photos/confirmation steps, exact-command retry, history and private image links. Mount on driver working times and photos workspace. Add responsive, reduced-motion-aware styling.
- [x] Run targeted tests, full single-worker regressions, local database tool tests, lint and production build. Add authenticated HTTP coverage and attempt browser acceptance when available. Record actual limitations; Chromium download failed, so browser execution is explicitly blocked.
- [x] Write Stage 22C migration/user acceptance/verification docs, preserve all historical migration bytes, package v0.1.25 and update the existing release artifact.
