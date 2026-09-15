# Stage 18 — Consistent sorting and filtering

Version 0.1.18 adds sorting and fixes filter behaviour in the shared operational lists.

## Changes

Use the sort field and direction controls, or select a supported column heading. The active heading exposes ascending/descending state to assistive technology. Sorting covers the whole matching dataset before pagination, including numerical stock and score fields. Equal values use an ID tie-breaker. Only supported fields have sort buttons; derived fields such as current driver names, total hours and workflow labels are not offered as sortable columns.

Document status choices are always Valid, Expiring and Expired. They filter the actual results and totals. Score status is an exact text filter because uploaded sources can define their own status strings; it is no longer a dropdown derived from the current page. Status options for other lists come from a shared allowlist. Assignment history offers active/closed states; vehicle filters include available/assigned states while preserving driver ownership.

Changing search, status, week or sort returns to page 1. Reset restores the default ordering and the current week for score/planning. Planning's server query now shares that current-week default. The URL retains successful query settings. Late responses are discarded, failed requests show an error, and rows are hidden while a request is loading or failed. If a mutation removes the last result on a page, the next reload moves back to the last valid page.

Reports now search the complete aggregate list. CSV downloads retain the selected search, week and ordering and include all matching aggregate rows. Some report values are current snapshots; only labels saying “im Zeitraum” describe the selected time interval.

Specialised account/invitation panels, the audit view and staff assignment board retain their existing dedicated controls and fixed ordering. This stage does not add arbitrary sorting to those screens.

## Ordering and consistency limits

Text ordering uses database collation; nullable fields follow PostgreSQL defaults: ascending nulls last, descending nulls first. Report labels use German text comparison. No result is sorted only within the currently loaded page.

Separate page requests reflect concurrent changes. The ID tie-breaker stabilises equal sort values; it does not freeze a dataset across visits. Generic list count and row queries are separate reads and can briefly differ during concurrent changes. Snapshot/export qualification remains part of production testing.

## Upgrade

No new migration is required for Stage 18. Install dependencies, build and restart with your existing environment. If upgrading from before Stage 17, apply all pending additive migrations with `npm run db:migrate` first. Preserve the database and configured jobs; do not reset or reseed operational data.

## Browser test checklist

1. Use more than 25 inventory records. Sort stock descending, then ascending, and move between pages. Check numeric ordering and matching totals.
2. Sort drivers with identical names; check stable page boundaries. Refresh and verify the selected controls remain in the URL.
3. Filter documents by every expiry state, including an empty result. Combine status with search. As a driver, confirm peer documents remain hidden.
4. Enter a score status occurring only beyond the first page of the original week. Confirm it is found and page 1 is selected. Change weeks and reset.
5. As a driver, select assigned vehicles and confirm only your current assignments appear. Available/inactive filters must not expose other drivers' vehicles.
6. Apply report search/week/sort, download CSV and compare the matching aggregate rows and order.
7. Switch filters rapidly, test an invalid sort URL, retry an error and delete/archive the last item on a later page. Confirm no stale result overwrites the latest request and pagination recovers.
8. Use keyboard controls, narrow-screen wrapping and reduced motion. Confirm sort headers announce the selected direction.

See `STAGE-18-VERIFICATION.md` for executed checks. Browser acceptance remains pending. Next: Stage 19, native deployment and migration qualification. Twenty-three stages remain, including deferred stages 14–15 and twelve optional extensions.
