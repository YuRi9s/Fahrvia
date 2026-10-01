# Stage 22A — Employee shift controls

Version 0.1.23. This is the first of four user-requested additions inserted after Stage 22. The original Stage 23 (native PostgreSQL concurrency qualification) remains separate.

## What is delivered

A DRIVER with an active linked driver profile can use the Arbeitszeiten page to begin work, begin a break, resume work and finish a shift. Finishing during a break closes that break at the same timestamp. The card displays the current server-recorded shift, working duration, accumulated breaks and up to 100 recent transitions. The existing private work-time history remains below it.

The mobile layout uses large labelled controls, a tabular timer, a separate break total and an explicit finish confirmation. The clock is not a browser stopwatch: closing the page does not stop a shift. A reload, foreground return or periodic refresh restores server state. Subtle entry/press animations respect reduced motion.

Only server timestamps are accepted. Commands contain an action, an idempotency identifier and, except for starting, the current entry ID and version. Client-supplied timestamps or additional fields are rejected. Duplicate request identifiers cannot create duplicate events; a reused key with different contents and stale versions return conflicts. The database enforces one active clock entry per driver. Driver-level locks coordinate starting with existing administrative manual-entry overlap checks.

Exact break milliseconds are retained and used for totals. The legacy whole-minute field remains for compatibility; list displays round break minutes to two decimals. Timestamps are stored as UTC instants and displayed in Berlin time, including shifts crossing midnight. No automatic break deduction, shift cutoff, GPS or photo requirement is introduced.

## Permissions and integrity

- The clock endpoint is DRIVER-only and verifies live membership, organisation, linked driver identity and active status inside its transaction.
- Employee generic create/edit/approve work-time endpoints remain forbidden. No other driver's entry can be selected for a clock action.
- Dispatchers retain work-time read access but can no longer create or change work-time entries. Administrator approval remains available.
- Clock events are append-only. Changes and audit entries commit together.
- Existing manual records remain manual. An open manual entry blocks a new clock start until an administrator resolves it.
- Clock-created entries cannot be changed through the generic administrator edit form. The next delivery adds audited correction requests; this release does not pretend that workflow exists already. Existing manual corrections continue with reasons and revision records.

## Connection failures

A request is not shown as confirmed until the server acknowledges it. During an uncertain response, new actions are disabled and “Bestätigung erneut anfordern” retries the same request identifier. The pending command is retained in this tab's session storage when available and scoped to the signed-in user's ID. A definitive 4xx rejection clears the pending command and refreshes server state.

This is not an offline queue. If the browser's storage is unavailable, the pending command survives only in memory. A completely closed tab may lose its pending request, but a successful server-side action still appears on the next read. An unreceived offline action cannot be reconstructed as a verified timestamp; it requires the upcoming correction process. A running timer display is an estimate from the last server snapshot and is not a new attendance event.

## Apply the update

Keep your working configuration and local startup fixes. Back up your database before applying the new migration. Apply the source to your deployment using its existing procedure, then use the migration credential and configured environment for:

```bash
npm ci
npm run db:migrate
npm run build
```

The new migration is `20260921_shift_clock`. It adds clock fields to WorkTimeEntry, creates the event table/indexes and installs the append-only trigger. No old migration is edited and no existing work-time timestamps are rewritten. Use the migration account only for migration, and retain the runtime account for the application. Runtime permissions must include SELECT/INSERT on the new event table; your migration-owner default privileges may already provide these. Do not grant schema ownership or superuser privileges to the runtime account.

Restart with your established deployment procedure. On another computer, this command sequence still assumes PostgreSQL and credentials are already configured; it does not provision a new database automatically.

## Your test checklist

1. Sign in as a DRIVER and open Arbeitszeiten. Begin work, then refresh the page. The same shift must remain active.
2. Begin a break, wait briefly and resume. Repeat for a second break. Working time excludes those intervals.
3. Finish the shift, confirming the action. It appears in your history without an edit/delete control. Also test finishing while paused.
4. Open the same account in another tab. After a change, refresh the older tab; a stale action must be rejected, never applied to an unexpected state.
5. Simulate a lost response in a disposable environment. Retry the pending command and verify one event rather than two. Do not test outages against live attendance records.
6. Sign in as an administrator: the submitted shift is visible and can be approved. Clock timestamp editing is unavailable until the correction delivery. A dispatcher must not be able to create/edit work times.
7. Verify another driver's work-time records never appear in the first driver's list.
8. Test on a phone with reduced motion enabled and with a screen reader/keyboard where available.

The added Playwright driver workflow uses the disposable fixture:

```bash
npx playwright install chromium
npm run test:e2e:local -- --grep 'driver shift'
```

Use a separate extracted test copy. The complete local suite now contains 32 project/test combinations. The original Stage 22 browser prerequisites and restrictions still apply.

## Not delivered in this increment

Correction requests/evidence and administrator decisions (22B), guided vehicle inspections (22C), and damage review/resolution (22D) remain separate deliveries. Native PostgreSQL concurrency, full browser acceptance and previous production gates remain open. This source update is not a payroll or legal-compliance certification.
