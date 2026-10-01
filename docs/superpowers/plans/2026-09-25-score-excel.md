# Score Excel implementation plan

> Execute inline using the executing-plans workflow. User approved score import/export first; PHR/concessions are a separate delivery.

**Goal:** Import supplied score workbooks with preview and export authorized filtered scores.
**Architecture:** Extend the bounded isolated parser; reuse immutable import drafts/mappings as saved mapping presets. Reuse existing weekly revisions with explicit replacement consent and an optimistic predecessor check. Generate data-only OOXML with the existing fflate dependency. Share query filters between list and export.
**Tech stack:** Next.js 16.3.4, React 19.2.8, Prisma 7.10.0, PostgreSQL, fflate, isolated Node worker.
**Spec:** User-approved workflow in docs/STAGE-14A.md (delivered alongside implementation).

## Constraints

- Node >=24.19.0 <25; exact existing dependency lock retained.
- No score calculations, invented metrics, name matching, or PHR/concessions ingestion.
- Preserve tenant/driver scope, parser isolation and existing archive limits.
- No historical SQL changes. Draft previousId records the observed predecessor. Add nullable ScoreImport.selection in one additive migration to preserve worksheet/header metadata.
- No Git publishing; deliver a versioned source ZIP.

## Tasks

- [x] Parser: tests for screenshot headers, punctuation, arbitrary sheet/header row, invalid selection and hostile unselected sheet. Add `readScoreWorkbook` plus optional selection to the isolated worker; inspection returns only bounded metadata/sample before creating drafts.
- [x] Import service: tests that replacement requires consent, stale previews fail and inspections do not write; preserve deduplication. History supplies stored mappings for explicit reuse. Persist selected sheet/header metadata in the new nullable selection JSON field.
- [x] Export: shared scoped score filter, bounded all-matching query, data-only XLSX with typed numeric cells and escaped text. Tests read the ZIP/XML independently and verify own-only and tenant filters against migrated PGlite database.
- [x] UI: upload → sheet/header/mapping → preview → confirm. Changing any input invalidates preview. Show all source metrics, missing values, whole-week replacement impact; reusable mappings selected from history. Export follows current week/search/status/sort, not just current page.
- [x] Verification: parser/worker tests, integration tests, typecheck, lint, production build, focused browser/HTTP test where available. Document real-workbook and browser validation limits.
- [x] Review and delivery: review changes, fix findings, update release docs to v0.1.26, verify historical migration bytes and archive contents; replace existing release with guarded version update.
