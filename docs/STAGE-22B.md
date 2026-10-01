# Stage 22B — Time correction requests

Version **0.1.24** includes Stage 22A shift controls, Stage 22B correction requests, and the local database tooling previously delivered separately as v0.1.22-db.1. The database-tooling branch is now integrated with the current product code. Historical migrations are unchanged; the complete chain now contains 17 migrations.

## Employee workflow

Open **Arbeitszeiten** and expand **Korrektur für abgeschlossene Schicht beantragen**. Browse completed shifts in pages of 20. Choose a shift, propose the actual start/end and total break duration, and explain the discrepancy (10–2,000 characters). Dates are entered in **Europe/Berlin**, independent of the device timezone; ambiguous daylight-saving times require an occurrence selection when changing the time. Unchanged fields preserve their original timestamp precision.

Optionally select an existing personal document as evidence. The latest 100 available personal documents are listed. Upload a new JPG, PNG or PDF through the existing **Dokumente** workflow first, then return and refresh the request panel. Existing file validation, private storage, PDF scanning and download authorization continue to apply. No external evidence URLs are fetched, and a photo/document is not automatically treated as proof that a claim is correct.

Submitting a request does not change the recorded shift. Employees cannot approve, directly edit or delete the request. One pending request per shift is allowed. Requests are immutable: after rejection, submit a new proposal if needed. Requests can cover clock entries and completed manual legacy entries. Legacy break accounting requires whole minutes; clock entries retain millisecond precision. The form labels break input in **seconds** to preserve existing exact durations.

Open shifts must first be ended with Stage 22A controls. Creating an entirely missing shift and correcting a currently running shift remain outside this employee-request workflow; existing administrator manual creation remains available. There is no automatic payroll calculation or automatic deduction of breaks.

## Administrator workflow

Open **Arbeitszeiten**. The new panel defaults to pending requests. Compare the recorded values at submission with the proposed values, review the reason and optional evidence, then choose approval or rejection and record a review reason.

Approval applies the exact proposal; administrators do not silently change the employee's proposed values in this screen. It rechecks that the shift is still closed, belongs to the original employee and has the expected version, and that its proposed time interval does not overlap another shift. If the shift has changed, reject the stale request and ask for a new proposal. Rejection leaves working times unchanged.

An approved correction:

- Adds a WorkTimeRevision with the previous effective values.
- Stores immutable before/after values and the reviewer, decision identifier, reason and timestamp in the request.
- Updates the effective start/end/break values and increments the shift version.
- Sets the shift to SUBMITTED and clears any prior approval. Review/approve the corrected working time separately using the existing work-time approval flow.
- Commits the time change, revision, request decision and audit event in one transaction.

Original start/pause/resume/finish events are never rewritten. The shift clock displays current effective times; its timeline is explicitly labelled as original bookings. An administrator cannot decide a request they submitted, or a request for their own linked driver profile. Another administrator must review it. Dispatchers cannot access the correction API or evidence through correction links.

## Access and reliability

The server checks live membership, tenant scope, current role, linked driver identity and active driver status. Hiding controls is not the permission boundary. Employees only receive requests and completed entries belonging to their own driver profile; admins receive their organization's requests.

Evidence is pinned to the stored object at submission. Archiving/renewing its document entry does not erase evidence from an existing request. Downloads still require the employee's own request/profile or an authorized admin in the same organization. Other file access rules remain unchanged. Evidence retention needs to follow the eventual organization retention policy; this stage does not add automatic deletion.

Requests and decisions carry identifiers for safe retry. Repeating the same successful command returns success without another mutation. Reusing an identifier with different content, duplicate pending requests, stale approvals and attempts to change a final decision are rejected. During an uncertain response the current form locks its inputs and offers **Bestätigung erneut anfordern** with the same command. This pending command is held in component memory, not an offline queue. Reloading loses the unsent draft/retry state; refresh the list to check whether the server accepted the request before creating another. Server constraints and version checks prevent duplicate business changes.

A database partial unique index enforces one pending request per shift. Database triggers preserve proposal fields and prevent changing/deleting completed decisions. Row locking follows the existing entry → driver → membership order; overlapping corrections are checked again under the driver lock. **Native PostgreSQL concurrency qualification is still pending**, so this delivery does not close the original Stage 23 gate.

## Install / upgrade

Preserve private configuration, existing database records and any working local startup fixes.

For an installation already using the managed Docker workflow:

```sh
npm run db:upgrade
npm run local:dev
```

Upgrade backs up first and runs the checked-in migrations as the migration role, then updates and checks runtime grants. For a brand-new managed installation use `npm run local:bootstrap`. See `LOCAL-DATABASE.md` for the one-time transfer from the existing Stage 19 native PostgreSQL installation; the tooling refuses to overwrite an unmanaged `.env`.

For an existing native/production deployment, use its established backup and explicit migration job with the migration identity, then restore the runtime identity before starting the app. Apply **20260922_time_corrections** (and **20260921_shift_clock** if upgrading from v0.1.22), build the release and restart through the established deployment procedure. Production startup does not run migrations.

Runtime grants must cover SELECT/INSERT/UPDATE on WorkTimeCorrection and existing WorkTimeEntry, WorkTimeRevision and AuditLog access. Migration-owner default privileges may provide them; do not grant schema ownership or superuser rights. Evidence reads use existing StoredObject/Document access. The new migration does not update any existing work-time timestamp or delete any records.

Docker acceptance remains blocked in the development environment. Browser interaction is also unverified here because Chromium is absent. See `STAGE-22B-VERIFICATION.md` for executed checks and limitations.

## Your test checklist

1. As an employee, finish a shift, request an earlier actual start with a reason, and confirm the shift itself remains unchanged while the request is pending.
2. Attach an existing own document. Confirm another employee cannot see your request or retrieve its evidence.
3. As an admin, approve the request with a reason. Confirm the corrected times appear, original clock events remain, and the shift needs approval again.
4. Submit a separate request and reject it. Check that working times remain unchanged and the employee can read the decision reason.
5. Change/approve a shift after its request was submitted; the stale request must not be approved. An overlapping proposal must likewise fail approval.
6. Retry a request/decision after an uncertain response. Confirm one request and one revision, not duplicates. Test only with disposable records.
7. Check a narrow phone viewport, keyboard navigation, dark mode and reduced-motion preferences.

Next delivery after your test: **Stage 22C — guided vehicle inspection and required photos**. Work-time recording starts before the inspection, so inspection work is counted. Damage review/restrictions remain Stage 22D.
