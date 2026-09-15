# Changelog

## 0.1.0 — 2026-09-08

Initial React/Next.js implementation checkpoint. Added German fleet and driver workspace, server-side identity/permissions, PostgreSQL schema and integrity migrations, private file workflow, score revision imports, manual PHR/Concessions revisions, weekly planning, work-time approval, conversations and expiry alerts.

Security review led to session-specific MFA assurance, old-session revocation at enrollment, owning-record file authorization, dispatcher action restrictions, driver/vehicle lock alignment, version-checked work-time approval and restricted dashboard audit data.

This checkpoint does not claim full v1 scope, browser verification, production infrastructure verification or a live deployment. See `docs/RELEASE_STATUS.md`.

## 0.1.1 — 2026-09-09

- Add searchable, paginated record selectors and preserve selections outside the current result page.
- Support full-name driver search and scoped record resolution. Paginate and filter eligible message recipients.
- Add subtle form entry, backdrop and press animations that respect reduced motion.
- Add database regressions and a staged delivery/test checklist.

## 0.1.2 — 2026-09-09

- Use Berlin local dates for calendar days, week boundaries and week navigation.
- Interpret operational form times in Berlin and require explicit offsets at the API boundary.
- Reject nonexistent times, offer an autumn occurrence choice and preserve unchanged timestamps.
- Add reduced-motion-aware calendar transitions and timezone/database regression tests.

## 0.1.3 — 2026-09-09

- Add administrator-managed staff invitations with expiry, resend and revocation.
- Accept single-use invitation links into new credential accounts and organization memberships; link driver accounts to existing active profiles.
- Protect role grants, existing passwords, tenant boundaries and administrator MFA.
- Add email webhook handoff, explicit development-only test links and invitation rate-limit cleanup.
- Add invitation administration/acceptance screens and reduced-motion-aware transitions.
- Include an additive migration and upgrade, email integration and acceptance instructions.

## 0.1.4 — 2026-09-09

- Add searchable, paginated account administration and active/disabled filters.
- Change roles and disable/restore membership access with a required reason, optimistic version checks, current server-side permissions and atomic audit records.
- Revoke all target-user sessions on changes. Invalidate issuer invitation links by membership version, including after access restoration; show these invitations as requiring resend.
- Protect self and super-administrator accounts. Only super-administrators can manage or grant the administrator role.
- Preserve historical driver links; require an active linked driver for driver access. Archiving a former driver no longer disables their promoted staff account.
- Reuse reduced-motion-aware confirmation animations and add animated success feedback.

## 0.1.5 — 2026-09-09

- Add administrator-only driver reactivation to the existing driver table, with a reason and confirmation dialog.
- Restore the same profile while preserving linked history, account access and closed vehicle assignments.
- Check live permissions and expected update timestamp under a row lock; record the transition and reason atomically.
- Reuse reduced-motion-aware dialog and success transitions. Add regression coverage and the Stage 5 test checklist.

## 0.1.6 — 2026-09-09

- Add category rename/archive/restore with version checks, reasons, live administrator permissions and atomic audit records.
- Add scoped vehicle brand/provider category references and an additive migration that links exact existing labels while preserving unmatched values.
- Keep archived categories on existing vehicles; reject new assignments to archived categories and propagate category renames to linked vehicle labels.
- Add paginated active-category suggestions to vehicle forms, category usage counts and reduced-motion-aware dialogs/selection transitions.
- Add category lifecycle, provider, pagination and legacy-upgrade integration tests.

## 0.1.7 — 2026-09-10

- Add individual key creation, replacement and retirement with live administrator checks and required reasons.
- Preserve retired identities and link replacements to their predecessor; enforce four active slots with a partial unique index.
- Require version-checked custody changes; block modification of retired keys and retirement/replacement of driver-held keys.
- Add immutable, paginated custody history with previous/replacement navigation and existing reduced-motion-aware dialogs.
- Count active keys in vehicle forms and retain key changes in the dedicated workflow.
- Add lifecycle/history/upgrade tests; make earlier migration fixtures target their specific migration.

## 0.1.8 — 2026-09-15

- Add the weekly assignment board with week/day navigation, plate search and current availability filters.
- Count every overlapping assignment per Berlin day; paginate history independently.
- Add immediate assignment and confirmed return dialogs with reduced-motion-aware transitions.
- Recheck live staff write permissions and serialize duplicate returns to avoid duplicate audit entries.
- No database migration added in this stage.

## 0.1.9 — 2026-09-15

- Add Details & Verlauf to driver and staff vehicle lists, with responsive event lists and existing reduced-motion-aware transitions.
- Merge assignment starts/returns, document additions/renewals, key custody, vehicle photo/damage events and recorded lifecycle actions into a paginated history.
- Filter by Berlin calendar week and event type; keep tenant scope and limit driver self-access to their own assignments.
- No database migration is added.

## 0.1.10 — 2026-09-15

- Add paired driver/vehicle participants to waves and migrate existing full or partial single participants.
- Add planned-wave editing, active progress entry, read-only details and confirmed start/completion.
- Require versions for writes, recheck staff permissions and active resources, and serialize competing starts.
- Block resource archival while participating in an active wave. Preserve existing wave totals and statuses on upgrade.

## 0.1.11 — 2026-09-15

- Add inventory custody for a driver or vehicle with quantity, reason and staff identity.
- Reduce available stock on issue; restore quantities on partial or full return. Keep custody, stock, movement and audit writes atomic.
- Prevent duplicate issue retries, competing stock over-issue, excess returns and stale return requests.
- Show available/outstanding totals and paginated open/closed custody records. Preserve existing stock and adjustment records in the migration.

## 0.1.12 — 2026-09-15

- Add searchable Bestandsverlauf for one item or all inventory, with movement type/week filters and stable pagination.
- Show signed quantities, reasons, recipients and scoped staff attribution for adjustments, issues and returns.
- Aggregate increases, decreases and net change across all matching records. Distinguish these totals from historical stock balances.
- Index movement lookup and protect saved movements from UPDATE/DELETE; corrections remain new movements.

## 0.1.13 — 2026-09-15

- Add versioned minimum-stock alert settings and a scoped active-staff picker, including self-selection.
- Evaluate stock adjustments, custody issues/returns and threshold changes in their transactions; add a periodic reconciliation command.
- Send one in-app alert per low-stock episode and recipient, preserve read state on rechecks and resolve on stock recovery.
- Show configuration/delivery availability in inventory and open/resolved status in notifications; hide staff stock alerts from driver-role sessions.
- Existing inventory starts with no alert recipient; migration does not send notifications.

## 0.1.16 — 2026-09-15

- Defer stages 14–15 until representative import files are available.
- Add notification acknowledgement, current ownership, assigned next actions, due dates and completion outcomes with version checks and audit entries.
- Add durable in-app reminders, recipient checks, retry backoff and visible failure status. Reminder creation and parent state changes commit atomically.
- Keep stock resolution tied to actual recovery; hide staff-only notifications from driver-role sessions.
- Preserve legacy notification state without enrolling old records in reminders. Add the deployment reminder job command.

## 0.1.17 — Stage 17

Added administrator audit/security investigation with exact filters, inclusive Berlin date ranges, stable pagination and expandable redacted metadata. Security events now carry organisation scope and are append-only; account-access changes record security evidence atomically. Legacy unscoped security events remain preserved and hidden. See `docs/STAGE-17.md` for coverage limits and acceptance checks.

## 0.1.18 — Stage 18

Added shared UI/API sort choices with stable ID tie-breakers across the generic lists. Document expiry and source-defined score status filters now run before pagination. Fixed report search and carried report filters into CSV exports. Filter/week/sort changes reset pagination, late requests cannot overwrite newer results, and invalid sort/status/page parameters return readable errors. Added accessible sort headers and reduced-motion-aware press feedback. No new migration.

## 0.1.19 — Stage 19 preparation

Added read-only source-deployment checks for runtime configuration, built files, PostgreSQL runtime role and migration checksums/history, with optional HTTPS endpoint probes. Reports exclude credentials and raw connection errors. Updated operating guidance. Native PostgreSQL install/upgrade and real HTTPS service qualification remain pending; this is not a production-readiness approval.

## 0.1.20 — Stage 20 preparation

Enforced absolute scanner paths, distinguished detected threats (422) from scanner unavailability (503), and retained private temporary-file cleanup. Added subprocess/storage contract tests and an opt-in provider round-trip probe. Live scanner detection, bucket privacy and role-specific browser qualification remain open. No migration.

## 0.1.21 — Stage 21

- Share invitation and password-recovery transport with bounded requests and no redirects.
- Validate endpoint configuration and canonical authentication-link origin; redact provider failures.
- Add configuration-only email check and provider contract/acceptance instructions.
- No migration. Live delivery and recovery qualification remains pending.

## 0.1.22 — Stage 22

- Add mobile drawer focus management, Escape/close controls, inert background, hidden closed navigation and expanded-state semantics.
- Make the skip link focus the main content; label driver navigation and mark its current page.
- Add disposable browser fixture and role, keyboard, reduced-motion and CSP checks.
- No migration. Browser execution remains blocked by unavailable Chromium in the development workspace.
