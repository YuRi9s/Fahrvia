# Release status — 0.1.20

Stage 22 (0.1.22) improves mobile navigation accessibility and adds `npm run test:e2e:local`. See `docs/STAGE-22.md` (or `STAGE-22.md` from this folder). Browser execution and deployment acceptance remain pending.

Stage 21 (0.1.21) adds a shared invitation/recovery email transport, redirect rejection and `npm run email:check`. See `docs/STAGE-21.md` (or `STAGE-21.md` from this folder). Live provider and inbox qualification remains pending.

This is an implementation checkpoint, not the complete production Version 1.0 requested in the master brief. The code is an operational React/Next.js application with database-backed workflows. No live deployment or production credentials are included.

Stage 1 adds searchable, paginated driver/vehicle/recipient selectors and reduced-motion-aware form transitions. See `STAGE-01.md` for user acceptance and `STAGES.md` for the sequenced backlog. Stage 1 was handed off before proceeding to Stage 2; no detailed browser test results were supplied.

Stage 2 corrects Berlin calendar/time-entry semantics and adds explicit DST occurrence handling. See `STAGE-02.md`. Stage 2 user acceptance and production gates remain pending.

Stage 3 adds administrator-managed staff invitations, single-use acceptance and testable email handoff. Apply the additive migration and follow `STAGE-03.md`. No live messages were sent during implementation; browser and live-email acceptance remain pending.

Stage 4 adds account search, role/access changes, session revocation and versioned audit records. See `STAGE-04.md` and `STAGE-04-VERIFICATION.md`. Browser acceptance remains pending.

Stage 5 restores archived driver profiles with a required reason, live administrator checks and stale-edit protection. Account access and closed assignments remain unchanged. See `STAGE-05.md`.

Stage 6 adds category rename/archive/restore, scoped vehicle brand/provider links, active category selectors and link-preserving migration. See `STAGE-06.md`.

Stage 7 adds individual key receipt, replacement, retirement and paginated custody history. Retired keys retain their identity and history; vehicle forms count active keys only. See `STAGE-07.md`.

## Implemented

| Area             | Current behavior                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | Password login/reset integration, TOTP/recovery, per-session MFA assurance, active organization membership and revocation checks      |
| Fleet            | Driver/vehicle create and edit, assignment/return, individual keys/custody, archive/reactivate service history                        |
| Authorization    | Default-deny modules, dispatcher action restrictions, own-driver/participant reads, tenant constraints, private DTOs                  |
| Planning         | ISO-week filters, weekly/day calendar view, event create/edit/soft delete                                                             |
| Waves            | Driver and vehicle references, package progress, guarded status transitions                                                           |
| Work time        | Create/correct, retained revisions, overlap checks, version-checked administrator approval                                            |
| Inventory        | Items, nonnegative stock adjustments, minimum stock, persisted movement history                                                       |
| Scores           | CSV/XLSX preview/mapping, missing-value preservation, isolated parser, commit/revision rollback, private original source retention    |
| Delivery details | Own-driver ISO-week PHR/Concessions, independent of score availability; admin manual entry and immutable corrections with provenance  |
| Documents/photos | Bounded uploads, image re-encoding, private access, explicit vehicle-document visibility, document renewal/archive, damage resolution |
| Conversations    | Participant-only paginated master/detail interface, search, unread counts, replies and explicit read state                            |
| Notifications    | New-message notifications; deterministic daily document-expiry alerts                                                                 |
| Reports          | Fleet, assignments, work-time totals, document expiry and inventory summaries; formula-safe CSV export                                |
| Interface        | German workspace, mobile navigation, theme preference, account popover, reusable dialogs and specialized views                        |
| Delivery         | Lockfile, SQL migrations, bootstrap/provision commands, Dockerfile, provider-neutral CI script and documentation                      |

## Executed verification

The latest command results are recorded in `STAGE-07-VERIFICATION.md`; `VERIFICATION.md` retains the original baseline. Database and identity regression tests use the actual Prisma adapter and Better Auth handlers with a disposable PGlite PostgreSQL engine. They are not mocks of the authentication outcome.

The scoped dependency overrides were introduced after the initial audit found transitive advisories. The final scan result, rather than the initial scan, determines the delivered audit status.

## Still required before v1

- Organization selection and linking an existing non-driver account to a driver profile remain pending. Browser-based invitations are implemented in Stage 3; live email delivery and browser acceptance still require verification.
- Station/group assignment workflows and full history/detail exploration. Category lifecycle and vehicle brand/provider relationships are implemented; station/group labels have no assignment fields yet. Unmatched legacy vehicle labels remain supported.
- Inventory custody/assigned-quantity workflow and movement-history UI. Stock movements already persist.
- Multiple driver/vehicle participants per wave. The current wave supports one driver and one vehicle reference.
- Typed/versioned score-metric definitions, source-specific spreadsheet adapters and workbook ingestion of PHR/Concessions. Current manual delivery records deliberately remain independent of score rollback.
- A durable general outbox/job system, more role-aware operational alerts and a restricted audit/security-log explorer. Audit rows are append-only, but a complete security-event ingestion pipeline is not implemented.
- Consistent sortable columns, grouped driver assignment history, complete detail/history screens and consolidation of feature-local German strings.
- Measured browser/mobile usability, accessibility, visual fidelity and CSP verification. The browser smoke suite is included but has not run in this workspace.
- Native PostgreSQL race testing, S3/email/scanner integration, container startup, load/resource limits, backup restoration and operational monitoring verification.

The agent preview could not launch the Next.js server because it supplies Vite-specific CLI options. No alternate public deployment, weaker authentication mode or static mock was substituted. Native deployment and browser verification remain explicit release gates.

## Security-review disposition

The review found and corrected an incompatible MFA schema, old password-only sessions surviving enrollment, overly broad vehicle-file access, dispatcher account-revocation capability, driver/key archival races, stale work-time approval, dashboard audit leakage and inconsistent lifecycle date edits. Score parsing now runs in a separate process with a deadline. Regression tests cover key cases, but these findings do not imply a complete independent penetration test.

The design-baseline documents preserve the intended v1 architecture; this status, the API reference and the operations guide describe the implementation actually delivered.

Stage 8 adds a staff weekly assignment board with day focus, current availability, paginated assignment history, immediate assignment and confirmed return. See `STAGE-08.md`. Browser acceptance remains pending.

Stage 9 adds driver and vehicle summaries with a paginated operational event history, Berlin week/type filters and scoped driver self-access. See `STAGE-09.md`. Browser acceptance remains pending.

Stage 10 adds multiple driver/vehicle pairs per wave, version-checked editing and progress, confirmed transitions and active-wave conflict checks. Apply the additive migration and follow `STAGE-10.md`. Browser/native deployment qualification remains pending.

Stage 11 adds inventory custody for drivers or vehicles, partial/full returns, retry-safe issue requests, version-checked returns and paginated custody records. Apply the additive migration and follow `STAGE-11.md`. The searchable movement history remains Stage 12. Browser and native deployment qualification remain pending.

Stage 12 adds item-specific and whole-inventory movement history, text/week/type filters, complete filtered totals, scoped staff attribution and protection against movement edits/deletions. See `STAGE-12.md`. Browser and native deployment qualification remain pending.

Stage 13 adds configured low-stock recipients, immediate transactional evaluation, periodic reconciliation, duplicate suppression per shortage/recipient, recovery resolution and staff-only notification access. See `STAGE-13.md`. Production scheduling, browser and native deployment qualification remain pending.

Stages 14–15 are deferred because representative source reports are unavailable. Stage 16 adds notification acknowledgement, staff-owned next actions, optional deadlines, completion outcomes and a bounded reminder retry worker. Existing notifications are not automatically enrolled; new notifications default to one reminder after 24 hours. See `STAGE-16.md`. Browser, scheduling and native production qualification remain pending.

Stage 17 adds tenant-scoped administrator audit/security investigation and atomic account-access security events. See `STAGE-17.md`. Browser acceptance, authentication event collection and production qualification remain outstanding.

Stage 18 adds server-side sorting and consistent filtering to generic lists, plus filtered report exports. Specialised account, invitation, audit and assignment-board views retain their existing controls and fixed ordering. See `STAGE-18.md`. No new database migration; browser acceptance and production qualification remain pending.

Stage 19 deployment tooling is prepared in 0.1.19. Native PostgreSQL fresh-install/upgrade and actual HTTPS runtime qualification remain open because no native server or Docker was available in this workspace. See `STAGE-19.md`; no operational database was changed.

Stage 20 scanner/storage tooling is delivered in 0.1.20. Live scanner signatures/detection, private bucket access and browser download qualification remain pending. Stage 19 native fresh-install migration evidence was supplied by the user; HTTPS and backup-upgrade qualification remain open.
