# Stage 8 — Weekly assignment board

Version 0.1.8 adds the board to the existing **Zuweisungen** module for administrators and dispatchers.

Navigate weeks, focus on one day, search plates and filter current availability. Day cells show the full number of overlapping assignments. Open a cell or **Wochenverlauf** for paginated history. **Jetzt zuweisen** starts an assignment immediately; **Rückgabe** opens the history where a running assignment can be returned with confirmation. Availability is rechecked when saving.

Current availability is separate from historical occupancy. Open assignments carry into future days until returned; future days are not reservations. Physical key custody is handled separately in **Schlüsselmappe**.

## Upgrade

No new database migration is required when upgrading from 0.1.7. Preserve your local environment configuration and operational database. Install dependencies and run `npm run build`, then restart the application. If upgrading from an earlier stage, apply its pending migrations using `npm run db:migrate` before building. Never reset the database for this upgrade.

## User test checklist

1. Open Zuweisungen as an administrator or dispatcher. Navigate previous/next week and select a day, then return to the whole week.
2. Search a plate and try each availability filter. Verify current availability remains distinct from historical day counts.
3. Open a day and weekly history; compare driver and start/return times. With more than 25 records, use the next page and confirm the day count includes all records.
4. Assign an available vehicle and driver. Confirm the current availability updates and assigned records disappear from the selectors. Try a competing assignment in another browser tab; the second save must fail.
5. Return the assignment with confirmation. Confirm its end time and restored availability. Repeat from a stale tab; it must fail without changing the original return time.
6. Verify key custody is still managed separately. Check week boundaries with overnight assignments and Berlin daylight-saving weeks.
7. Test keyboard navigation, dialog dismissal, mobile scrolling, single-day view, and reduced-motion settings.

Automated evidence is in `STAGE-08-VERIFICATION.md`. Browser and deployment qualification remain pending. Stage 9 starts after this handoff is tested.
