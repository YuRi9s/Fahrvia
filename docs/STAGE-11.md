# Stage 11 — Inventory custody

Version 0.1.11 adds **Inventar → Ausgabe & Rückgabe**. Staff can issue a quantity to one active driver or vehicle, record a reason, and take back some or all of that quantity. The dialog shows available stock and quantities still issued. Open, fully returned and all custody records are independently paginated.

The existing stock value represents units available in the store. Issuing reduces it; a return increases it. Quantities still with a recipient are shown separately. Direct warehouse withdrawals and stock corrections continue to use **Zu-/Abgang**. Returning inventory is allowed after a recipient has been archived, so offboarding does not strand custody records.

A stable request identifier prevents the same issue submission from reducing stock twice. Returns require the current custody version, preventing stale or duplicate returns. Conflicting stock operations serialize on the inventory item. If a request is interrupted, refresh and inspect the recorded balance before starting a new action. A new issue form represents a new issue request.

This stage records quantity custody, not serial-number asset tracking, loss/write-off handling or consumable use by the recipient. The searchable movement history is Stage 12. Custody balances are not a full owned-stock valuation.

## Upgrade from Stage 10

Back up the operational database using your established procedure. Preserve local environment settings, install dependencies, stop the old app, run `npm run db:migrate`, then `npm run build` and restart. The additive migration is `20260916_inventory_custody`. Do not reset or reseed the operational database.

Existing item stock and adjustment quantities/reasons are preserved. Existing movements are marked ADJUST with no custody reference. No historical recipient or custody balance is invented.

## Browser test checklist

1. Open an inventory row's **Ausgabe & Rückgabe** dialog. Verify available stock and outstanding quantities.
2. Issue a quantity to an active driver with a reason. Repeat for a vehicle. Available stock must decrease and the matching holder must appear.
3. Try an excessive, zero or fractional quantity, an empty reason, or an inactive recipient. Invalid requests must not change stock.
4. Return part of an issue, then its remainder. Verify available stock, returned/remaining quantities and open/closed filters.
5. Use two tabs to compete for the last stock or return the same balance. Only a valid request may succeed; stale returns must not double-increase stock.
6. Retry an interrupted issue from the same form. Check that the same request creates at most one custody record. Refresh before opening a new issue form.
7. With more than 25 issues, verify pagination and that the outstanding total includes all records regardless of the open/closed filter.
8. Confirm returns still work for an archived recipient. Test keyboard focus, Escape, errors, mobile scrolling and reduced motion.
9. In a disposable database copy, apply the migration and compare existing stock and adjustments before/after.

See `STAGE-11-VERIFICATION.md` for automated evidence. Stage 12 has not started.
