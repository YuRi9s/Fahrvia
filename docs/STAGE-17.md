# Stage 17 — Audit and security investigation

Version 0.1.17 adds **Audit & Sicherheit** to the administrator navigation. Existing administrators and super-administrators can inspect their own organisation's recorded changes. Dispatchers and drivers cannot access the page or API.

## Investigation workflow

Choose the change log or security events. Filter by inclusive Berlin calendar dates, exact actor account ID, action/event code, record ID and (security only) event reference. Filters apply before pagination to the complete matching result set. Results are newest first, with an ID tie-breaker for equal timestamps. Each page shows 25 events and a total. Filters are preserved in the URL for refresh and navigation.

Expand an event to view its identifier and structured metadata, including before/after values where the original producer recorded them. Actor names reflect current organisation memberships; actor IDs remain available for historical investigation. Sensitive metadata keys are redacted recursively, and detail depth/length is bounded. This is a defensive display filter, not a guarantee that arbitrary free text contains no personal data.

The investigation interface is read-only. Audit records already reject updates and deletion at database level; this migration extends that protection to security events. These controls do not prevent a privileged database operator from changing the database itself.

## Security coverage

Future account role/access changes produce `account-access-changed` events atomically with the change and session revocation. Failed or stale changes produce no successful-change event. The event reference is generated for this recorded event; it is not an HTTP request trace identifier.

Existing security events lack reliable organisation attribution. They are preserved with a null organisation and excluded from this view. No organisation is guessed from a user's current membership. Existing organisation-scoped audit events remain visible.

This stage does not capture authentication attempts, all rejected requests or infrastructure events. It is not a complete security monitoring or incident-management system. An empty security view means no supported events match; it does not establish that no security activity occurred.

## Upgrade

Back up the operational database and preserve your environment. Install dependencies, stop the old application, run `npm run db:migrate`, build with `npm run build`, then restart. The additive migration is `20260920_audit_investigation`. Never reset or reseed operational data for this upgrade. No new job or external integration is required. Existing reminder/stock/expiry jobs remain required as configured in earlier stages.

## Browser test checklist

1. As an administrator, open **Audit & Sicherheit** and expand an existing change. Confirm IDs, Berlin timestamp and before/after metadata where available.
2. Filter by the displayed actor, action and record IDs. Change pages and refresh; verify the URL retains the filters. Reset them.
3. Test an inclusive date range, an empty result and an invalid/reversed date range. Confirm a readable error rather than a broken page.
4. In disposable test accounts, change a role or deactivate access. Switch to security events and find one `account-access-changed` entry with the affected membership ID and revoked-session count.
5. Verify dispatchers and drivers have no navigation entry and cannot open `/audit` or `/api/v1/audit`. Verify another organisation's records cannot be retrieved using known IDs.
6. Disable/demote an investigator and verify their old session can no longer retrieve events.
7. Check keyboard filter controls, disclosure controls, narrow-screen horizontal table scrolling and reduced motion.

Browser acceptance and production PostgreSQL qualification remain pending. Stage 18 is consistent sorting/filtering. Twenty-four stages remain, including deferred import stages 14–15 and twelve optional extensions.
