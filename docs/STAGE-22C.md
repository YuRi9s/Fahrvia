# Stage 22C — Guided vehicle inspections

Version **0.1.25** continues v0.1.24 and includes the shift clock, correction requests and managed local database tooling. It adds a guided pre-drive inspection with required photos, private history and immutable evidence. The chain contains 18 additive SQL migrations.

## Driver workflow

1. Open **Arbeitszeiten** and choose **Arbeit beginnen**. Inspection is work, so the timer starts first. Pause/end controls remain available.
2. The inspection panel shows the currently assigned active vehicle. Without a current assignment, contact dispatch. A paused shift must be resumed before submission.
3. Enter the odometer in kilometres. Explicitly answer each checklist item: tyres/wheels, lights, mirrors/windows and warning indicators. Report uncertainty as an issue. Declare whether there is visible damage. Describe any issue/damage in at least 10 characters.
4. Supply four current images: **front, rear, left and right**. Declared damage also requires a fifth detail image. Each view must use a different image. JPG/PNG only, at most 10 MiB per image and 24 MiB combined; the existing HTTP envelope limit remains 25 MiB. HEIC must be converted before upload.
5. Review and submit. The server rechecks the running shift, live driver access, active vehicle and current assignment before committing. The receipt identifies the immutable report and server receipt time.

The form has three steps, local previews, labelled controls, mobile layouts, light/dark styles and reduced-motion-aware transitions. The latest draft and exact pending command are retained in tab memory across in-app navigation and browser Back, keyed to the authenticated actor, shift and assignment. Closing/reloading the tab or starting a different inspection can lose this temporary draft; ending the shift prevents further submission. The browser may show a leave warning while the dirty form is open. This is not durable storage or an offline queue. Camera capture is a device/browser hint. The application cannot prove that a photo was taken live or that its contents match a particular view. Exact duplicate images are rejected, not all possible reused/manipulated images.

For an uncertain response, keep the page open and use **Bestätigung erneut anfordern**. This repeats the exact UUID, metadata and photo bytes. Refreshing the report list can confirm an accepted request. An exact retry still returns its receipt after the shift/assignment ends; revoked access is still rejected. There is no automatic background queue.

One inspection is accepted per shift and assignment. Switching vehicles requires an inspection of the new assignment; a new shift needs a new inspection. Generic photo reports under Fotos remain separate and do not satisfy this checklist.

## Staff workflow and boundaries

Open **Fotos** for paginated inspection history. Administrators and dispatchers can read operational reports for their organization, including labelled private photo links, odometer, checklist, reported damage and notes. Drivers can see only reports from their own profile and reporting identity. Work-time details are not returned to staff through the inspection endpoint.

A receipt confirms that a report was received. It does **not** certify roadworthiness or authorize departure. If anything is unsafe or uncertain, the driver must contact dispatch before driving. Stage 22D will add formal damage review, restrictions and resolution. There is currently no trip-start endpoint to block, so this stage enforces mandatory photos for inspection submission, not a physical or software interlock on departure.

Submitted inspections, their photo links, stored-object pointers and original report content cannot be edited/deleted through normal database operations. Existing report resolution metadata remains separate. A mistaken submission must be escalated to an administrator; this stage does not add report replacement or deletion. Existing driver time controls and correction history are unchanged.

## Upgrade

Back up the database and preserve private configuration and stored files. For an existing **managed Docker** installation:

```sh
npm run db:upgrade
npm run local:dev
```

For a new managed installation:

```sh
npm run local:bootstrap
npm run local:dev
```

Existing **native PostgreSQL Stage 19 installations** should use their established backup and explicit migration-role deployment procedure in `OPERATIONS.md` and `STAGE-19.md`; see `LOCAL-DATABASE.md` for transfer to managed Docker. Do not overwrite a working native `.env` or run bootstrap expecting it to adopt an unmanaged database.

Apply `20260924_vehicle_inspections` using the migration identity, generate the client, and build before restarting the app with its restricted runtime identity. This migration adds VehicleInspection, photo-position metadata, scoped constraints and evidence guards. It does not modify existing work-time values or rewrite historical migrations. Native runtime grants require SELECT/INSERT on VehicleInspection alongside existing photo/object/audit grants; the managed upgrade applies its standard grants automatically. Do not grant schema ownership, superuser or BYPASSRLS privileges. Production application startup does not run migrations.

A database dump contains records and object references, **not image bytes**. Back up/restore the configured private object store separately. For local filesystem storage, preserve `.data/files` alongside the corresponding database backup. Restore both before expecting evidence downloads to work. Do not copy Docker volumes between computers as a transfer procedure.

## Failure handling and privacy

Images pass signature/type/size checks, decoded pixel limits and JPEG re-encoding through the shared upload pipeline. Embedded EXIF/location metadata is removed. Original bytes are hashed for idempotency; raw originals are not retained. No public bucket or new CSP allowance is introduced.

Failed validation or a known aborted transaction removes newly stored bytes on a best-effort basis. When a transaction outcome is unknown, bytes are retained to avoid deleting potentially committed evidence. The log event `inspection_upload_cleanup_deferred` identifies the need for later reconciliation; there is no automatic orphan-file deletion job in this stage. Private storage, retention and external object-store recovery still require deployment qualification.

## Acceptance checklist

Use disposable test records and actual vehicle photos.

1. Start work, enter an assigned vehicle's checklist and submit all required views. Verify the timer runs throughout and the report appears under Fotos.
2. Omit one view, select a corrupt/unsupported file, reuse one image for two views or exceed the limits. Submission must fail without a partial report.
3. Declare damage: require descriptive notes and a damage image. Report a checklist issue without visible damage: require notes, but only four general views.
4. Pause the shift, revoke the assignment or change access before submission. Verify the server refuses it; resume/reload as appropriate.
5. Retry the exact accepted request. Confirm one inspection, one photo report and one audit event. Changed content with the same request ID must conflict.
6. Sign in as another driver and a different organization's admin. Neither should access the original report/images. The original author retains image access after the assignment ends.
7. Review in phone width, keyboard-only navigation, light/dark mode and reduced motion. Ensure labels, focus, photo previews and error messages work. Navigate to another app section and use Back: the current draft and selected photos must reappear.
8. Back up and restore both the database and private files in a disposable environment; verify the report and image downloads.

See `STAGE-22C-VERIFICATION.md` for executed checks and limitations. Next staged delivery: **22D — damage review, restrictions and resolution**.
