# Stage 1 — Searchable record selectors

Version: 0.1.1. Status: implemented for user acceptance; not a production release.

## Delivered

The shared forms now provide server-backed search and 25-result pages for drivers, vehicles and message recipients. Drivers can be searched by full name, email or transporter ID; vehicles by registration, VIN, brand or model; recipients by name. Names that repeat show driver email or transporter ID to help distinguish people.

An existing selection stays selected while searching or changing pages. Edit dialogs resolve that record independently of the first page, using the same server authorization rules. Search failures have a retry action. Old requests are cancelled and ignored when the search changes. Search inputs do not submit the form on Enter; native selection controls preserve normal keyboard/mobile behavior.

Dialogs have a short fade/slide entry, a fading backdrop and button press feedback. Record-picker entry and focus transitions respect the operating system's reduced-motion preference. No animation dependency or 3D assets were added.

## Install into your local setup

This is the full application source. Extract into a new folder so the previous working copy remains available. Copy your existing `.env` into that folder; do not share its contents. Keep the same database URL and authentication settings. No schema migration, data reset or seed is required for Stage 1.

Using the existing Node 24 setup:

```bash
npm ci
npm run db:generate
npm run dev
```

Stop the previous development server first if it uses the same port. If you made local source-code changes beyond `.env`, merge the changed files below instead of replacing those changes.

## Please test

1. Open **Zuweisungen → Neu anlegen**. Search for a driver by full name, then select a vehicle by registration and save a valid assignment.
2. Search by transporter ID/email and by VIN/brand/model. Change the search quickly; the results should match the final text.
3. If your data has more than 25 matching records, use the previous/next result buttons. Records after number 100 must remain reachable. Do not create fake records in your live database just to test this; automated database tests cover 105 records.
4. Open an existing editable planning event or key custody record. Its existing driver/vehicle selection should appear. Searching for something else must not silently replace it.
5. Search for a nonexistent name. You should see a clear empty state and retain your existing selection.
6. Compose a message and search recipients, but cancel unless you actually intend to send it.
7. Try Tab, arrow keys and Enter in the selection controls. Required selections must still be enforced. Typing Enter in the search field must not save the form.
8. Try a narrow mobile viewport and dark mode. Watch dialog opening and button feedback. Enable reduced motion in the OS/browser: entry animations should stop.
9. Optional: interrupt the connection during a search. An error/retry control should appear, without losing your selection. Reconnect and retry.

Report the screen, steps, expected/actual result and a screenshot if useful. Stage 2 (calendar time consistency) starts after your feedback on Stage 1.

## Changed implementation files

- `src/components/record-picker.tsx` — reusable paginated search/selection control.
- `src/components/entity-dialog.tsx` — integrates the picker into shared forms.
- `src/server/queries.ts` — scoped record resolution, full-name driver search and paginated recipient search.
- `src/messages/de.ts` — German picker text.
- `src/app/globals.css` — picker layout and reduced-motion-aware transitions.
- `tests/integration.test.ts` — database regression coverage.

Package metadata and release documentation also change. No database schema, dependency versions or credentials change.

## Verification boundaries

See `STAGE-01-VERIFICATION.md` for executed checks. Browser interaction, visual fidelity and animation timing still need acceptance testing; passing database tests and a production build does not establish those properties. The broader production gates in `RELEASE_STATUS.md` remain open.
