# Stage 9 — Driver and vehicle details/history

Version 0.1.9 adds **Details & Verlauf** to driver lists and staff vehicle lists in the main app. The dialog shows current record fields and a newest-first event history with 25 events per page. Filter by event type or Berlin calendar week. Clear the filters for the entire stored history.

Staff can inspect assignment starts/returns, document additions/renewals, directly associated key custody entries, recorded create/edit/archive/reactivate actions, and vehicle photo/damage reports and resolutions. Drivers can open their own driver row and see their assignment starts/returns only. No score data is included in the timeline.

The week filter applies to when an event happened. An assignment started earlier appears when its start or return falls in the selected week; use the Stage 8 board for occupancy across a week. Summary fields and linked driver names/plates show current values. This is a history of stored events, not a reconstruction of past field values. Key entries associated with a driver cover entries naming that driver; returns to the office are visible in the vehicle/key history. Existing records without audit events do not acquire invented lifecycle events.

## Upgrade

No new migration is needed from 0.1.8. Preserve local environment settings and your database, install dependencies, build with `npm run build`, then restart. When upgrading from older stages, apply their pending migrations with `npm run db:migrate`. Do not reset the database.

## Test checklist

1. Open **Fahrer → Details & Verlauf** and **Fahrzeuge → Details & Verlauf** as staff. Confirm the summary matches the selected record, including archived records.
2. Check assignment starts and returns against existing assignment records. Compare document renewals, key events and vehicle damage reports where available.
3. Filter by type and calendar week; clear filters. Verify Berlin timestamps around Sunday/Monday boundaries. An empty result must say no events were found.
4. With more than 25 events, navigate pages and confirm the total and ordering. Refresh after changing data in another tab.
5. Sign in as a driver and open the own driver row. Confirm only that driver's assignments appear, without scores, other drivers' records or full vehicle history.
6. Test dialog focus, Escape and Close, keyboard controls, mobile layout, scrolling and reduced-motion settings. Check loading, retry and no-results states.

See `STAGE-09-VERIFICATION.md` for automated evidence and remaining qualification. Stage 10 (multi-participant waves) has not started.
