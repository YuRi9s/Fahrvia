# Fahriva delivery stages

Each numbered stage is a separate delivery. Implement, verify, provide a test checklist, then wait for the user's results before starting the next stage. Fix feedback within the current stage first. The order after Stage 2 can change based on operating priorities.

Keep the established German interface and screenshot-based layout. Add restrained transitions to the feature being delivered: dialog entry, focus/press feedback and understandable state changes. Respect reduced motion. Consider optional 3D only for a useful purpose after the core workflows are stable; avoid decorative effects over operational tables.

Stages 1–13 have been delivered. Stages 14–15 are deferred until representative score/PHR/concessions files are supplied. Stage 16 is implemented in version 0.1.16 and awaits user testing. Stage 17 is implemented in version 0.1.17 and awaits user testing. Stage 18 is implemented in version 0.1.18 and awaits user testing. Stage 19 has deployment-check tooling in version 0.1.19; user-supplied logs verify the native fresh installation and migrations, while HTTPS startup and backup-upgrade rehearsal remain open. Stage 20 has scanner/storage checks in version 0.1.20; live service qualification is pending. After this handoff, 23 stages remain: the two deferred import stages, nine production qualification stages (19–27), and twelve optional extensions (28–39).

## Foundations and the original v1 scope

| Stage | Single delivery                          | Acceptance example                                                                    |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| 1     | Searchable record selectors              | Search/browse drivers, vehicles and recipients beyond 100; retain existing selections |
| 2     | Consistent Berlin calendar time          | Midnight, DST and week boundaries remain correct across device timezones              |
| 3     | Staff invitations                        | Invite, accept, expire and resend an invitation                                       |
| 4     | Account and role administration          | Authorized administrators change roles and revoke access                              |
| 5     | Driver reactivation                      | Restore an archived driver without losing history                                     |
| 6     | Category lifecycle and relationships     | Rename/archive a category without corrupting linked records                           |
| 7     | Physical key lifecycle                   | Add, replace or retire an individual key with custody history                         |
| 8     | Weekly assignment board                  | Navigate weeks/days and see availability and assignment history                       |
| 9     | Driver and vehicle detail/history        | Retrieve a vehicle's or driver's operational timeline                                 |
| 10    | Multi-participant waves                  | Assign several drivers/vehicles and track valid transitions                           |
| 11    | Inventory custody                        | Issue and return quantities to a person or vehicle                                    |
| 12    | Inventory movement history               | Find and explain a stock change                                                       |
| 13    | Low-stock alerts                         | Notify a responsible person without repeated duplicate alerts                         |
| 14    | Versioned score definitions and adapters | Preview real supplied workbooks with explicit metric meanings                         |
| 15    | PHR/concessions workbook ingestion       | Import supplied formats with row-level provenance and corrections                     |
| 16    | Reliable operational notifications       | Acknowledgement, retries and owned next actions                                       |
| 17    | Audit/security investigation             | Authorized staff investigate changes and security events                              |
| 18    | Consistent sorting/filtering             | Visible filters and sorts match full server results                                   |

## Production qualification

These are verification/configuration stages, not new feature screens. A stage may reveal fixes that must be retested before proceeding. Use disposable test data; never reset the user's operational database.

| Stage | Single delivery                       | Acceptance example                                                     |
| ----- | ------------------------------------- | ---------------------------------------------------------------------- |
| 19    | Native deployment and migrations      | App starts with the real production configuration and upgrade path     |
| 20    | Private files and scanner integration | Authorized downloads and failed/malicious uploads behave correctly     |
| 21    | Email integration                     | Invitations and recovery messages are delivered with correct links     |
| 22    | Browser/mobile/accessibility gate     | Actual role-specific workflows pass, including CSP and reduced motion  |
| 23    | Native PostgreSQL concurrency gate    | Conflicting assignment/approval/import requests preserve invariants    |
| 24    | Recovery and backup gate              | Restore both records and files from a backup                           |
| 25    | Monitoring and release automation     | Failures are observable; critical checks cannot silently skip          |
| 26    | Request interruption and load gate    | Safe retries, bounded resource use and measured load behavior          |
| 27    | Data lifecycle controls               | Verified offboarding, retention, export/deletion and access procedures |

## Product extensions from the audit

Validate the detailed behavior with the user before each delivery. These are proposed opportunities, not verified market exclusives. They do not all need to precede v1.

| Stage | Single delivery                           | Acceptance example                                                           |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| 28    | Score explanation and correction requests | Trace a changed metric and resolve a correction without rewriting its source |
| 29    | Evidence-based handovers                  | Compare incoming/outgoing condition and record disagreements                 |
| 30    | Pre/post-shift inspections                | Submit a checklist and open a defect with evidence                           |
| 31    | Defect/maintenance/downtime workflow      | Block an unavailable vehicle and release it after resolution                 |
| 32    | Driver eligibility and vehicle release    | Apply the agreed eligibility rules before dispatch                           |
| 33    | Replacement vehicle workflow              | Swap an unavailable vehicle while retaining assignment history               |
| 34    | Morning readiness board                   | Identify departure blockers, owners and next actions                         |
| 35    | Connected operational cases               | Link complaints, assignments, messages and evidence to one resolution        |
| 36    | Offline drafts and safe synchronization   | Resume interrupted work, show pending uploads and resolve conflicts          |
| 37    | Vehicle cost tracking                     | Report recorded fuel, lease and repair costs with source detail              |
| 38    | Bulk onboarding/import                    | Preview and import drivers/vehicles without duplicate entry                  |
| 39    | Vehicle return evidence pack              | Export a coherent condition and history package                              |

Source formats for stages 14–15 must come from representative, preferably anonymized workbooks. Live-service credentials and deployment access will be needed for the relevant qualification stages. Nothing in this roadmap authorizes sending invitations or messages to real people during development.
