# Stage 10 — Multi-participant waves

Version 0.1.10 extends **Wellen** with up to 100 distinct driver/vehicle pairs. Planned waves can be edited, active waves accept progress, and completed waves are read-only. **Teilnehmer & Details** shows the full participant list and package totals. Start and completion require confirmation.

Package progress belongs to the whole wave. A draft may have no participants, but starting requires at least one full pair of active records from the organization. No driver or vehicle may join another active wave concurrently. Planned waves can reuse resources; starting performs the final check. Participant composition, name, start and package total are fixed once active. Version checks prevent a stale tab from overwriting newer work. Resource archival is blocked until active waves finish.

Wave participation does not create or close physical vehicle assignments, reserve future availability, or transfer keys. Those operations retain their existing workflows. Partial delivery exceptions, cancellation and per-participant package allocation are not part of this stage.

## Upgrade from Stage 9

Back up your operational database using your established backup procedure. Keep local environment settings. Install dependencies, stop the old application, run `npm run db:migrate`, then `npm run build` and restart. The new migration is `20260915_wave_participants`; do not reset or reseed the operational database.

The migration adds versions and participant rows. Existing wave totals, delivery counts, names, dates and statuses remain unchanged. Existing partial participant pairs are retained; fill them in while planned before starting. Already-active legacy waves retain their state and can record progress/complete. The migration does not invent missing participants or rewrite pre-existing active conflicts. If a legacy foreign-key reference is invalid, migration fails rather than silently dropping it; repair the referenced record before retrying.

## Browser test checklist

1. Create a planned wave with two distinct driver/vehicle pairs. Reopen it and verify names, plates, Berlin start time, totals and participant count.
2. Add/remove pairs while planned. Try duplicate, inactive or incomplete pairs; saving must fail. An empty draft may save but cannot start.
3. Start a valid wave. Verify participant editing is replaced by progress entry and that details remain readable.
4. In two tabs, try starting different waves containing the same driver or vehicle. Only one should start. Try archiving an active participant; it must fail.
5. Update progress, then submit an older tab. It must report a stale version. Close, refresh the list and reopen to obtain the latest values.
6. Try completing before all packages are delivered; it must fail. Complete after totals match and verify further edits are blocked.
7. Check migration with representative existing full and partial legacy waves in a disposable copy first.
8. Test keyboard focus, Escape, error handling, narrow screens, scrolling and reduced-motion settings. Confirm vehicle assignments and key custody are managed separately.

Stage 11 (inventory custody) starts after this delivery. There are 29 roadmap stages left after Stage 10, including 12 optional product extensions.
