# Score imports

Administrators upload UTF-8 CSV or data-only XLSX with an explicit ISO week. Preview stores a DRAFT and returns normalized rows, mapping, columns and row errors. Errors prevent commit. No score or bonus is calculated; missing optional values remain null. Unmapped source columns become string metrics.

Mapping is source column → `email`, `transporterId`, `week`, `totalScore`, `rank`, `packages`, `bonus`, `focusArea`, `status`, or `metric:<label>`. Canonical column names map automatically. Driver matching is restricted to organization-scoped exact transporter IDs or case-insensitive email. If both are supplied both must match. Names and client driver IDs are never guessed. Duplicate drivers fail validation. A supplied source week must equal the selected real ISO week.

Limits: 5 MB input, 16 MB actual cumulative ZIP expansion, 200 archive entries, 5000 data rows, 100 columns, 2000 characters per cell, XML nesting 32. XLSX uses the first workbook worksheet; ZIP64, split/encrypted archives, unsupported compression, macros, embeddings, external references, DTD/entities, formula and error cells are rejected. Archive expansion is streamed in 1024-byte compressed chunks, with actual emitted byte accounting and termination at the budget. All XML entries are screened, including sheets not imported. Source text is never evaluated. CSV formula-like cells are rejected. Decimal comma and decimal point are accepted, thousands separators are not.

Commit rechecks live administrator membership and tenant driver IDs in a serializable transaction. An organization/week advisory lock serializes revision transitions. Existing active revision becomes SUPERSEDED; new scores and COMMITTED state plus audit event are atomic. Revert accepts only the currently COMMITTED import, marks it REVERTED and restores its immediate SUPERSEDED predecessor. All revision and score records remain available for audit. Hash deduplication covers normalized data, selected week, mapping and errors. Existing matching drafts are reused and already active identical data is rejected.

History returns the latest 100 organization imports without row data. API mutations require authenticated membership, same-origin requests and the shared mutation rate limit. Driver score queries must filter the source import to COMMITTED and apply driver ownership (implemented by the shared query service).

Validation: `npx vitest run tests/score.test.ts`. Parser tests cover normalization, matching, duplicates, source weeks, formulas, XML entities, expansion bombs, encrypted/truncated archives and ordinary XLSX metrics. Database atomicity/concurrency requires the PostgreSQL integration suite; parser unit tests do not establish that database behavior.

## Stage 14A extension

See `STAGE-14A.md`. The first-sheet-only limitation above is superseded: an inspection request (`inspect=true`) lists worksheets and returns a bounded sample without creating a draft. `sheet` selects a worksheet by name; `headerRow` selects its physical header row (1–100). CSV header rows use record positions. Invalid selected-sheet content can return an inspection warning so a different sheet can be chosen; global archive/XML security errors still fail.

Mapping recognizes screenshot aliases and supports repeated `ignore` targets. Punctuation in metric labels is accepted within the bounded label grammar. Existing import mappings can be explicitly reused from history. Selection metadata is persisted in the nullable `selection` JSON column. Draft `previousId` now records the observed active predecessor; commit requires that it is still active and `confirmReplacement: true` if replacing a revision. Old drafts with an obsolete predecessor require a new preview.

`GET /api/v1/score/export` accepts the score list's week/q/status/sort/dir filters. It exports all authorized matching active rows with a 5000-row ceiling. Membership is rechecked, including driver profile linkage; tenant and driver scope are imposed server-side. The download is private/no-store and rate-limited. No production startup migration or dependency change is introduced.
