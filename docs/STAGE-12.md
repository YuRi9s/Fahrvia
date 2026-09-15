# Stage 12 — Inventory movement history

Version 0.1.12 adds **Inventar → Bestandsverlauf** for all items and a row-level **Verlauf** button for one item. The dialog lists warehouse movements/corrections, issues and returns with signed quantities, reasons, recipients and staff attribution. Search by item, SKU, reason, recipient name/plate or staff name; optionally filter by movement type and Berlin calendar week.

Results are paginated at 25 records, newest first with a stable ID tie-breaker. Increase/decrease/net totals cover every matching record. These totals describe recorded quantity changes; they are not a reconstruction of historical stock or owned-stock value. Item summaries and names use current records. Legacy entries whose actor cannot be resolved within the organization show **Nicht mehr verfügbar**.

Saved movements cannot be edited or deleted. Correct stock using a new **Zu-/Abgang** entry with a clear reason. Correct custody through its issue/return workflow; a warehouse adjustment does not close a custody record. The history's **Ausgaben öffnen** button opens the item's custody list, where filters show open or completed issues.

## Upgrade from Stage 11

Back up the operational database using your established procedure. Keep environment settings, install dependencies, stop the old app, run `npm run db:migrate`, then `npm run build` and restart. The additive migration is `20260917_inventory_history`. Do not reset or reseed the operational database.

The migration adds an index and movement protection trigger. It does not rewrite existing stock, movements or custody records. Scripts that edit/delete movement records must use explicit new correction entries instead.

## Browser test checklist

1. Open **Bestandsverlauf** above the inventory list, then open one item's **Verlauf**. Verify the scope and current item summary.
2. Compare a warehouse adjustment, issue and partial/full return with their source records. Check signs, quantities, reasons, recipients and staff names.
3. Search by item/SKU, reason, driver/plate and staff name. Filter by type and week, then reset. Check empty results and retry after an error.
4. Verify dates near Sunday/Monday boundaries use Berlin time and only events inside the selected week appear.
5. With more than 25 movements, navigate pages and verify no duplicate/missing rows for unchanged data. Totals must include every matching record.
6. Open custody from an issue/return row and use the open/closed filter as needed. Make a correction through the existing workflow and refresh the history; the original movement must remain.
7. Confirm another organization's records are inaccessible and driver-role access is denied.
8. Test keyboard focus, Escape/Close, narrow-screen scrolling and reduced-motion settings.

See `STAGE-12-VERIFICATION.md` for automated evidence. Stage 13 (low-stock alerts) has not started. There are 27 stages left after this handoff, including 12 optional extensions.
